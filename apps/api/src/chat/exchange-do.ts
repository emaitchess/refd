import {
  type ChatEvidenceRecord,
  type ChatScope,
  type ChatStreamEvent,
  chatExchangePhaseSchema,
  chatExchangeStatusSchema,
  chatScopeSchema,
  isActiveChatExchange,
} from '@refd/core/chat';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client';
import { chatExchanges, chats } from '../db/schema';
import type { AppEnv } from '../env';
import {
  type Emit,
  type Exchange,
  runExchange,
  type StreamEvent,
  storeFailure,
} from './exchange';
import {
  CHAT_EXCHANGE_TIMEOUT_MS,
  commitExchangeAnswer,
  commitExchangeFailure,
  messagesForExchange,
} from './lifecycle';

const historyShape = z.array(
  z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
  }),
);

const metaShape = z.object({
  exchangeId: z.string().uuid(),
  chatId: z.number().int().positive(),
  workspaceId: z.number().int().positive(),
  question: z.string().min(1).max(1000),
  history: historyShape.max(20),
  withTitle: z.boolean(),
  receivedAt: z.number().int().positive(),
  inheritedScope: chatScopeSchema.nullable().optional(),
  inheritedFromMessageId: z.number().int().positive().optional(),
  startedAt: z.number().int().positive(),
  deadlineAt: z.number().int().positive(),
  lastEventSeq: z.number().int().nonnegative(),
  status: chatExchangeStatusSchema,
  phase: chatExchangePhaseSchema,
});

type ExchangeMeta = z.infer<typeof metaShape>;

const startShape = metaShape
  .pick({
    exchangeId: true,
    chatId: true,
    workspaceId: true,
    history: true,
    question: true,
    withTitle: true,
    receivedAt: true,
    inheritedScope: true,
    inheritedFromMessageId: true,
    deadlineAt: true,
  })
  .refine(
    (value) =>
      value.deadlineAt > value.receivedAt &&
      value.deadlineAt - value.receivedAt <= CHAT_EXCHANGE_TIMEOUT_MS,
    { message: 'invalid exchange deadline' },
  );

const exchangeIdShape = z.object({ exchangeId: z.string().uuid() });
const errorShape = z.object({ error: z.string().optional() });

export interface ExchangeStart {
  exchangeId: string;
  chatId: number;
  workspaceId: number;
  history: { role: 'user' | 'assistant'; content: string }[];
  question: string;
  withTitle: boolean;
  receivedAt: number;
  inheritedScope?: ChatScope | null;
  inheritedFromMessageId?: number;
  deadlineAt: number;
}

export class ChatExchangeRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const exchangeStub = (env: AppEnv, chatId: number) =>
  env.CHAT_EXCHANGE.get(env.CHAT_EXCHANGE.idFromName(String(chatId)));

export const startExchange = async (
  env: AppEnv,
  payload: ExchangeStart,
): Promise<void> => {
  const res = await exchangeStub(env, payload.chatId).fetch(
    'https://chat-exchange/start-v2',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
  if (res.ok) {
    return;
  }
  const parsed = errorShape.safeParse(await res.json().catch(() => null));
  throw new ChatExchangeRequestError(
    parsed.success && parsed.data.error
      ? parsed.data.error
      : 'could not start the exchange',
    res.status,
  );
};

export const cancelExchange = async (
  env: AppEnv,
  chatId: number,
  exchangeId: string,
): Promise<void> => {
  const res = await exchangeStub(env, chatId).fetch(
    'https://chat-exchange/cancel',
    {
      method: 'POST',
      body: JSON.stringify({ exchangeId }),
    },
  );
  if (res.ok) {
    return;
  }
  const parsed = errorShape.safeParse(await res.json().catch(() => null));
  throw new ChatExchangeRequestError(
    parsed.success && parsed.data.error
      ? parsed.data.error
      : 'could not cancel the exchange',
    res.status,
  );
};

export const purgeChatExchange = async (
  env: AppEnv,
  chatId: number,
): Promise<void> => {
  const res = await exchangeStub(env, chatId).fetch(
    'https://chat-exchange/purge',
    { method: 'POST' },
  );
  if (!res.ok) {
    throw new ChatExchangeRequestError(
      'could not purge the exchange',
      res.status,
    );
  }
};

const eventKey = (seq: number): string =>
  `event:${seq.toString().padStart(8, '0')}`;

export class ChatExchange {
  private writes: Promise<void> = Promise.resolve();
  // Evidence gathered by the exchange in flight, per exchange id. The alarm
  // and crash paths read it to persist the receipt of completed lookups; an
  // evicted object loses the copy, which costs diagnosis, not correctness.
  private exchangeEvidence = new Map<
    string,
    { records: ChatEvidenceRecord[] }
  >();

  constructor(
    private state: DurableObjectState,
    private env: AppEnv,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/start-v2' && request.method === 'POST') {
      return this.handleStart(request);
    }
    if (url.pathname === '/start' && request.method === 'POST') {
      return Response.json(
        { error: 'the exchange protocol was upgraded; retry the question' },
        { status: 426 },
      );
    }
    if (url.pathname === '/cancel' && request.method === 'POST') {
      return this.handleCancel(request);
    }
    if (url.pathname === '/purge' && request.method === 'POST') {
      return this.handlePurge();
    }
    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      return this.handleWatch(url);
    }
    return new Response('not found', { status: 404 });
  }

  private enqueueTask = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = this.writes.then(fn);
    this.writes = next.then(
      () => {},
      (error) => {
        console.error('chat exchange: task failed', error);
      },
    );
    return next;
  };

  private readMeta = async (): Promise<ExchangeMeta | null> => {
    const parsed = metaShape.safeParse(await this.state.storage.get('meta'));
    return parsed.success ? parsed.data : null;
  };

  private handleStart = async (request: Request): Promise<Response> => {
    const parsed = startShape.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(
        { error: 'invalid exchange payload' },
        { status: 400 },
      );
    }
    return this.enqueueTask(async () => {
      if (await this.state.storage.get<boolean>('purged')) {
        return Response.json({ error: 'chat was deleted' }, { status: 410 });
      }
      const current = await this.readMeta();
      const db = getDb(this.env);
      const target = (
        await db
          .select({
            status: chatExchanges.status,
            chatId: chatExchanges.chatId,
            workspaceId: chatExchanges.workspaceId,
          })
          .from(chatExchanges)
          .where(eq(chatExchanges.id, parsed.data.exchangeId))
      )[0];
      if (
        !target ||
        target.chatId !== parsed.data.chatId ||
        target.workspaceId !== parsed.data.workspaceId ||
        !isActiveChatExchange(target.status)
      ) {
        return Response.json(
          { error: 'exchange is no longer available to start' },
          { status: 409 },
        );
      }
      if (current?.exchangeId === parsed.data.exchangeId) {
        return new Response(null, { status: 204 });
      }
      if (current && isActiveChatExchange(current.status)) {
        const persisted = (
          await db
            .select({ status: chatExchanges.status })
            .from(chatExchanges)
            .where(eq(chatExchanges.id, current.exchangeId))
        )[0];
        if (persisted && isActiveChatExchange(persisted.status)) {
          return Response.json(
            { error: 'an exchange is already running for this chat' },
            { status: 409 },
          );
        }
      }

      this.closeAll(current?.exchangeId);
      await this.state.storage.deleteAll();
      this.exchangeEvidence.clear();
      const startedAt = Date.now();
      const meta: ExchangeMeta = {
        ...parsed.data,
        startedAt,
        lastEventSeq: 0,
        status: 'running',
        phase: 'gathering',
      };
      const claimed = await db
        .update(chatExchanges)
        .set({ status: 'running', phase: 'gathering', startedAt })
        .where(
          and(
            eq(chatExchanges.id, meta.exchangeId),
            eq(chatExchanges.chatId, meta.chatId),
            eq(chatExchanges.workspaceId, meta.workspaceId),
            eq(chatExchanges.status, target.status),
          ),
        )
        .returning({ id: chatExchanges.id });
      if (!claimed[0]) {
        return Response.json(
          { error: 'exchange is no longer available to start' },
          { status: 409 },
        );
      }
      await this.state.storage.put('meta', meta);
      await this.state.storage.setAlarm(meta.deadlineAt);
      this.state.waitUntil(this.run(meta));
      return new Response(null, { status: 204 });
    });
  };

  private handleCancel = async (request: Request): Promise<Response> => {
    const parsed = exchangeIdShape.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return Response.json({ error: 'invalid exchange id' }, { status: 400 });
    }
    const current = await this.readMeta();
    if (!current || current.exchangeId !== parsed.data.exchangeId) {
      return Response.json({ error: 'exchange not found' }, { status: 404 });
    }
    await this.fail(
      parsed.data.exchangeId,
      'Answering was cancelled.',
      'cancelled',
    );
    return new Response(null, { status: 204 });
  };

  private handlePurge = async (): Promise<Response> =>
    this.enqueueTask(async () => {
      this.closeAll();
      await this.state.storage.deleteAlarm();
      await this.state.storage.deleteAll();
      await this.state.storage.put('purged', true);
      return new Response(null, { status: 204 });
    });

  private handleWatch = async (url: URL): Promise<Response> => {
    const parsed = exchangeIdShape.safeParse({
      exchangeId: url.searchParams.get('exchangeId'),
    });
    const after = Number.parseInt(url.searchParams.get('after') ?? '0', 10);
    if (!parsed.success || !Number.isInteger(after) || after < 0) {
      return Response.json({ error: 'invalid watch request' }, { status: 400 });
    }
    const pair = new WebSocketPair();
    const server = pair[1];
    const found = await this.enqueueTask(async () => {
      const meta = await this.readMeta();
      if (!meta || meta.exchangeId !== parsed.data.exchangeId) {
        return false;
      }
      this.state.acceptWebSocket(server);
      server.serializeAttachment({ exchangeId: meta.exchangeId });
      for (let seq = after + 1; seq <= meta.lastEventSeq; seq += 1) {
        const event = await this.state.storage.get<ChatStreamEvent>(
          eventKey(seq),
        );
        if (event) {
          this.send(server, event);
        }
      }
      if (!isActiveChatExchange(meta.status)) {
        server.close(1000, meta.status);
      }
      return true;
    });
    if (!found) {
      return Response.json({ error: 'exchange not found' }, { status: 404 });
    }
    return new Response(null, { status: 101, webSocket: pair[0] });
  };

  private appendEvent = async (
    exchangeId: string,
    event: StreamEvent,
  ): Promise<ChatStreamEvent | null> =>
    this.enqueueTask(async () => {
      const meta = await this.readMeta();
      if (
        !meta ||
        meta.exchangeId !== exchangeId ||
        !isActiveChatExchange(meta.status)
      ) {
        return null;
      }
      const stored = {
        ...event,
        exchangeId,
        seq: meta.lastEventSeq + 1,
      } satisfies ChatStreamEvent;
      await this.state.storage.put({
        [eventKey(stored.seq)]: stored,
        meta: { ...meta, lastEventSeq: stored.seq },
      });
      return stored;
    });

  private setPhase = async (
    exchangeId: string,
    phase: 'gathering' | 'answering' | 'metadata',
  ): Promise<void> => {
    await this.enqueueTask(async () => {
      const meta = await this.readMeta();
      if (
        !meta ||
        meta.exchangeId !== exchangeId ||
        !isActiveChatExchange(meta.status)
      ) {
        throw new Error('stale chat exchange');
      }
      const updated = await getDb(this.env)
        .update(chatExchanges)
        .set({ phase })
        .where(
          and(
            eq(chatExchanges.id, exchangeId),
            eq(chatExchanges.status, 'running'),
          ),
        )
        .returning({ id: chatExchanges.id });
      if (!updated[0]) {
        throw new Error('exchange is no longer running');
      }
      await this.state.storage.put('meta', { ...meta, phase });
    });
  };

  private run = async (meta: ExchangeMeta): Promise<void> => {
    const emit: Emit = async (event) => {
      const stored = await this.appendEvent(meta.exchangeId, event);
      if (!stored) {
        throw new Error('stale chat exchange');
      }
      this.broadcast(stored);
    };
    try {
      const db = getDb(this.env);
      const evidenceSink: { records: ChatEvidenceRecord[] } = { records: [] };
      this.exchangeEvidence.set(meta.exchangeId, evidenceSink);
      const exchange: Exchange = await runExchange(
        this.env,
        db,
        meta.workspaceId,
        meta.history,
        meta.question,
        {
          withTitle: meta.withTitle,
          acceptedAt: meta.receivedAt,
          inheritedScope: meta.inheritedScope,
          inheritedFromMessageId: meta.inheritedFromMessageId,
          onPhase: (phase) => this.setPhase(meta.exchangeId, phase),
          evidenceSink,
        },
        emit,
      );
      const done = await this.enqueueTask(async () => {
        const current = await this.readMeta();
        if (
          !current ||
          current.exchangeId !== meta.exchangeId ||
          !isActiveChatExchange(current.status)
        ) {
          return null;
        }
        const finalizing = await db
          .update(chatExchanges)
          .set({ phase: 'finalizing' })
          .where(
            and(
              eq(chatExchanges.id, meta.exchangeId),
              eq(chatExchanges.status, 'running'),
            ),
          )
          .returning({ id: chatExchanges.id });
        if (!finalizing[0]) {
          throw new Error('exchange is no longer running');
        }
        const seq = current.lastEventSeq + 1;
        const messages = await commitExchangeAnswer(this.env, db, {
          chatId: meta.chatId,
          exchangeId: meta.exchangeId,
          exchange,
          lastEventSeq: seq,
        });
        if (!messages) {
          throw new Error('exchange lost the terminal write race');
        }
        this.exchangeEvidence.delete(meta.exchangeId);
        let title: string | null = null;
        title =
          (
            await db
              .select({ title: chats.title })
              .from(chats)
              .where(eq(chats.id, meta.chatId))
          )[0]?.title ?? null;
        const event: ChatStreamEvent = {
          type: 'done',
          exchangeId: meta.exchangeId,
          seq,
          chatId: meta.chatId,
          title: title ?? '',
          messages,
        };
        await this.state.storage.put({
          [eventKey(seq)]: event,
          meta: {
            ...current,
            status: exchange.status,
            phase: 'terminal',
            lastEventSeq: seq,
          },
        });
        await this.state.storage.deleteAlarm();
        return event;
      });
      if (done) {
        this.broadcast(done);
        this.closeAll(meta.exchangeId);
      }
    } catch (error) {
      const current = await this.readMeta();
      if (current?.exchangeId !== meta.exchangeId) {
        return;
      }
      console.error('chat exchange failed', error);
      await this.fail(
        meta.exchangeId,
        'The answer failed partway. Try again.',
        'failed',
      );
    }
  };

  private fail = async (
    exchangeId: string,
    message: string,
    status: 'failed' | 'cancelled',
  ): Promise<void> => {
    const failed = await this.enqueueTask(async () => {
      const meta = await this.readMeta();
      if (
        !meta ||
        meta.exchangeId !== exchangeId ||
        !isActiveChatExchange(meta.status)
      ) {
        return null;
      }
      const db = getDb(this.env);
      const steps: { label: string; detail?: string }[] = [];
      for (let seq = 1; seq <= meta.lastEventSeq; seq += 1) {
        const event = await this.state.storage.get<ChatStreamEvent>(
          eventKey(seq),
        );
        if (event?.type === 'step') {
          steps.push(
            event.detail === undefined
              ? { label: event.label }
              : { label: event.label, detail: event.detail },
          );
        }
      }
      const lookups = Math.max(
        (this.exchangeEvidence.get(exchangeId)?.records.length ?? 1) - 1,
        0,
      );
      const withEvidence =
        status === 'failed' && lookups > 0
          ? `${message} ${lookups} ${
              lookups === 1 ? 'lookup' : 'lookups'
            } completed first; the evidence gathered is saved with this reply.`
          : message;
      const seq = meta.lastEventSeq + 1;
      const committed = await commitExchangeFailure(this.env, db, {
        exchangeId,
        chatId: meta.chatId,
        message: withEvidence,
        steps,
        durationMs: Date.now() - meta.startedAt,
        status,
        lastEventSeq: seq,
        fromStatuses: ['running'],
        evidence: this.exchangeEvidence.get(exchangeId)?.records,
      });
      this.exchangeEvidence.delete(exchangeId);
      if (!committed) {
        return this.restoreTerminalEvent(db, meta);
      }
      const event: ChatStreamEvent = {
        type: 'error',
        exchangeId,
        seq,
        message: withEvidence,
      };
      await this.state.storage.put({
        [eventKey(seq)]: event,
        meta: {
          ...meta,
          status,
          phase: 'terminal',
          lastEventSeq: seq,
        },
      });
      await this.state.storage.deleteAlarm();
      return event;
    });
    if (failed) {
      this.broadcast(failed);
      this.closeAll(exchangeId);
    }
  };

  private restoreTerminalEvent = async (
    db: ReturnType<typeof getDb>,
    meta: ExchangeMeta,
  ): Promise<ChatStreamEvent | null> => {
    const row = (
      await db
        .select({
          status: chatExchanges.status,
          phase: chatExchanges.phase,
          lastEventSeq: chatExchanges.lastEventSeq,
          error: chatExchanges.error,
          title: chats.title,
        })
        .from(chatExchanges)
        .innerJoin(chats, eq(chatExchanges.chatId, chats.id))
        .where(eq(chatExchanges.id, meta.exchangeId))
    )[0];
    if (!row || isActiveChatExchange(row.status) || row.phase !== 'terminal') {
      return null;
    }
    const seq = Math.max(row.lastEventSeq, meta.lastEventSeq + 1);
    const event: ChatStreamEvent =
      row.status === 'completed' || row.status === 'partial'
        ? {
            type: 'done',
            exchangeId: meta.exchangeId,
            seq,
            chatId: meta.chatId,
            title: row.title,
            messages: await messagesForExchange(db, meta.exchangeId),
          }
        : {
            type: 'error',
            exchangeId: meta.exchangeId,
            seq,
            message: row.error ?? 'The answer did not complete.',
          };
    await this.state.storage.put({
      [eventKey(seq)]: event,
      meta: {
        ...meta,
        status: row.status,
        phase: 'terminal',
        lastEventSeq: seq,
      },
    });
    await this.state.storage.deleteAlarm();
    return event;
  };

  async alarm(): Promise<void> {
    const meta = await this.readMeta();
    if (meta) {
      await this.fail(
        meta.exchangeId,
        'The answer took too long and was stopped. Try again.',
        'failed',
      );
      return;
    }
    const legacy = z
      .object({
        chatId: z.number().int().positive(),
        startedAt: z.number().int().positive(),
        status: z.literal('running'),
      })
      .safeParse(await this.state.storage.get('meta'));
    if (legacy.success) {
      await storeFailure(
        getDb(this.env),
        legacy.data.chatId,
        null,
        'The answer was interrupted by an upgrade. Try again.',
        [],
        Date.now() - legacy.data.startedAt,
      );
      await this.state.storage.deleteAll();
    }
  }

  webSocketMessage(): void {}

  private socketExchangeId = (ws: WebSocket): string | null => {
    const parsed = exchangeIdShape.safeParse(ws.deserializeAttachment());
    return parsed.success ? parsed.data.exchangeId : null;
  };

  private closeAll = (exchangeId?: string): void => {
    for (const ws of this.state.getWebSockets()) {
      if (exchangeId && this.socketExchangeId(ws) !== exchangeId) {
        continue;
      }
      try {
        ws.close(1000, 'exchange ended');
      } catch {}
    }
  };

  private send = (ws: WebSocket, event: ChatStreamEvent): void => {
    try {
      ws.send(JSON.stringify(event));
    } catch {}
  };

  private broadcast = (event: ChatStreamEvent): void => {
    for (const ws of this.state.getWebSockets()) {
      if (this.socketExchangeId(ws) === event.exchangeId) {
        this.send(ws, event);
      }
    }
  };
}
