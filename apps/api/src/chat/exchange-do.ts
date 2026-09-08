// The ChatExchange durable object owns one chat's *running* exchange: the
// loop, the step trace and prose as they accumulate, and the live websocket
// connections watching them. It is a coordinator, not a store: chats and
// chat_messages stay in D1 (workspace-wide rate limiting joins them, and
// workspace deletion cleans them up through foreign keys). Hibernatable
// sockets mean an idle chat costs nothing; one instance per chat
// (idFromName(chatId)) also serialises exchanges for a chat.
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client';
import { chats } from '../db/schema';
import type { AppEnv } from '../env';
import {
  type Emit,
  type Exchange,
  runExchange,
  type StreamEvent,
  storeAnswer,
  storeFailure,
} from './exchange';

// Wall-clock ceiling on one exchange. The alarm is the insurance for a wedged
// run: model calls in flight keep the isolate alive, and a dead isolate still
// fires the alarm on its next wake-up.
const ALARM_MS = 5 * 60 * 1000;

interface ExchangeMeta {
  chatId: number;
  workspaceId: number;
  question: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  withTitle: boolean;
  receivedAt: number;
  startedAt: number;
  status: 'running' | 'complete' | 'failed';
}

const startShape = z.object({
  chatId: z.number().int().positive(),
  workspaceId: z.number().int().positive(),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string(),
      }),
    )
    .max(20),
  question: z.string().min(1).max(1000),
  withTitle: z.boolean(),
  receivedAt: z.number().int().positive(),
});

// Route-side glue: validate everything the synchronous flow validated, then
// hand the exchange to the chat's durable object. Throws when the object
// refuses (another exchange already running for this chat).
export interface ExchangeStart {
  chatId: number;
  workspaceId: number;
  history: { role: 'user' | 'assistant'; content: string }[];
  question: string;
  withTitle: boolean;
  receivedAt: number;
}

export const startExchange = async (
  env: AppEnv,
  payload: ExchangeStart,
): Promise<void> => {
  const stub = env.CHAT_EXCHANGE.get(
    env.CHAT_EXCHANGE.idFromName(String(payload.chatId)),
  );
  const res = await stub.fetch('https://chat-exchange/start', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (res.ok) {
    return;
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  throw new Error(body.error ?? 'could not start the exchange');
};

export class ChatExchange {
  // Serialized storage writes: emits, the alarm, and start-time cleanup all
  // funnel through one chain, so a reconnecting client's snapshot can wait
  // for the pending writes and read terminal-ly consistent state.
  private writes: Promise<void> = Promise.resolve();

  constructor(
    private state: DurableObjectState,
    private env: AppEnv,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/start' && request.method === 'POST') {
      return this.handleStart(request);
    }
    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      return this.handleWatch();
    }
    return new Response('not found', { status: 404 });
  }

  // Serialized storage tasks: emits, the alarm, and start-time cleanup all
  // funnel through one chain. A task that returns a value (a start verdict,
  // a reconnect snapshot) is read after the chain reaches it, so it is always
  // consistent with every write enqueued before it. A failing task is logged
  // and skipped; the chain survives.
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

  private handleStart = async (request: Request): Promise<Response> => {
    const parsed = startShape.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(
        { error: 'invalid exchange payload' },
        { status: 400 },
      );
    }
    return this.enqueueTask(async () => {
      const current = await this.state.storage.get<ExchangeMeta>('meta');
      if (current?.status === 'running') {
        return Response.json(
          { error: 'an exchange is already running for this chat' },
          { status: 409 },
        );
      }
      // The previous exchange's replay state (steps, prose, terminal result)
      // is cleared here, at the START of the next exchange, so a client that
      // connects after an exchange finished still learns its outcome.
      await this.state.storage.deleteAll();
      const meta: ExchangeMeta = {
        ...parsed.data,
        startedAt: Date.now(),
        status: 'running',
      };
      await this.state.storage.put('meta', meta);
      await this.state.storage.put(
        'steps',
        [] as { label: string; detail?: string }[],
      );
      await this.state.storage.put('prose', '');
      await this.state.storage.setAlarm(meta.startedAt + ALARM_MS);
      void this.run(meta);
      return new Response(null, { status: 204 });
    });
  };

  private handleWatch = async (): Promise<Response> => {
    // Wait behind pending writes, then snapshot inside the chain: the replay
    // and the live fan-out can never interleave (an event is either fully in
    // the snapshot or fully broadcast afterwards).
    const snapshot = await this.enqueueTask(async () => ({
      meta: await this.state.storage.get<ExchangeMeta>('meta'),
      steps:
        (await this.state.storage.get<{ label: string; detail?: string }[]>(
          'steps',
        )) ?? [],
      prose: (await this.state.storage.get<string>('prose')) ?? '',
      result: await this.state.storage.get<StreamEvent>('result'),
    }));
    const pair = new WebSocketPair();
    this.state.acceptWebSocket(pair[1]);
    const server = pair[1];
    if (snapshot.meta) {
      for (const step of snapshot.steps) {
        this.send(server, { type: 'step', ...step });
      }
      if (snapshot.prose) {
        this.send(server, { type: 'delta', text: snapshot.prose });
      }
      if (snapshot.meta.status !== 'running') {
        const result = snapshot.result;
        if (result) {
          this.send(server, result);
        }
        server.close(1000, snapshot.meta.status);
      }
    } else {
      this.send(server, {
        type: 'error',
        message: 'No exchange is running for this chat.',
      });
      server.close(1000, 'none');
    }
    return new Response(null, { status: 101, webSocket: pair[0] });
  };

  private run = async (meta: ExchangeMeta): Promise<void> => {
    const emit: Emit = async (event) => {
      this.broadcast(event);
      await this.enqueueTask(async () => {
        if (event.type === 'step') {
          const steps =
            (await this.state.storage.get<{ label: string; detail?: string }[]>(
              'steps',
            )) ?? [];
          steps.push(
            event.detail === undefined
              ? { label: event.label }
              : { label: event.label, detail: event.detail },
          );
          await this.state.storage.put('steps', steps);
        } else if (event.type === 'delta') {
          const prose = (await this.state.storage.get<string>('prose')) ?? '';
          await this.state.storage.put('prose', prose + event.text);
        }
      });
    };
    try {
      const db = getDb(this.env);
      const exchange: Exchange = await runExchange(
        this.env,
        db,
        meta.workspaceId,
        meta.history,
        meta.question,
        { withTitle: meta.withTitle },
        emit,
      );
      // The alarm may have failed this exchange while the run was in flight;
      // its verdict wins, so nothing is written or broadcast afterwards.
      const current = await this.state.storage.get<ExchangeMeta>('meta');
      if (current?.status !== 'running') {
        return;
      }
      // The question row was written when the request was accepted, so only
      // the answer is inserted here.
      const messages = await storeAnswer(db, meta.chatId, exchange);
      // Same title rule the synchronous flow had: the model-named title wins,
      // the truncated first question stays as the fallback.
      let title: string | null = null;
      if (exchange.title) {
        await db
          .update(chats)
          .set({ title: exchange.title })
          .where(eq(chats.id, meta.chatId));
        title = exchange.title;
      } else {
        title =
          (
            await db
              .select({ title: chats.title })
              .from(chats)
              .where(eq(chats.id, meta.chatId))
          )[0]?.title ?? null;
      }
      const done: StreamEvent = {
        type: 'done',
        chatId: meta.chatId,
        title: title ?? '',
        messages,
      };
      await this.enqueueTask(async () => {
        await this.state.storage.put('meta', { ...meta, status: 'complete' });
        await this.state.storage.put('result', done);
        await this.state.storage.deleteAlarm();
      });
      this.broadcast(done);
      this.closeAll();
    } catch (error) {
      console.error('chat exchange failed', error);
      await this.fail('The answer failed partway. Try again.');
    }
  };

  private fail = async (message: string): Promise<void> => {
    const failed = await this.enqueueTask(async () => {
      const meta = await this.state.storage.get<ExchangeMeta>('meta');
      if (meta?.status !== 'running') {
        return null;
      }
      await this.state.storage.put('meta', { ...meta, status: 'failed' });
      await this.state.storage.put('result', {
        type: 'error',
        message,
      } satisfies StreamEvent);
      await this.state.storage.deleteAlarm();
      return meta;
    });
    // The failure belongs in D1, not only in this object's storage. Without a
    // row the thread ends on the question, and a reader who reconnects after
    // the sockets closed cannot tell a dead exchange from a running one.
    if (failed) {
      const steps =
        (await this.state.storage.get<{ label: string; detail?: string }[]>(
          'steps',
        )) ?? [];
      try {
        await storeFailure(
          getDb(this.env),
          failed.chatId,
          message,
          steps,
          Date.now() - failed.startedAt,
        );
      } catch (error) {
        console.error('chat exchange: could not store the failure', error);
      }
    }
    this.broadcast({ type: 'error', message });
    this.closeAll();
  };

  async alarm(): Promise<void> {
    await this.fail('The answer took too long and was stopped. Try again.');
  }

  webSocketMessage(): void {
    // Client sockets are receive-only; nothing to answer.
  }

  // Terminal events end the exchange; the sockets close so a watching client
  // settles on the close (its replay path covers reconnects after the end).
  private closeAll = (): void => {
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.close(1000, 'exchange ended');
      } catch {
        // Already closing.
      }
    }
  };

  private send = (ws: WebSocket, event: StreamEvent): void => {
    try {
      ws.send(JSON.stringify(event));
    } catch {
      // A closing socket drops the event; live fan-out continues.
    }
  };

  private broadcast = (event: StreamEvent): void => {
    for (const ws of this.state.getWebSockets()) {
      this.send(ws, event);
    }
  };
}
