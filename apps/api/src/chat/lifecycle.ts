import type {
  ChatEvidenceRecord,
  ChatExchangeSummary,
  ChatStartResponse,
} from '@refd/core/chat';
import { CHAT_EXCHANGE_TIMEOUT_MS } from '@refd/core/chat';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { chatExchanges, chatMessages, chats } from '../db/schema';
import type { AppEnv } from '../env';
import type { Exchange } from './exchange';
import { messageShape } from './exchange';

export { CHAT_EXCHANGE_TIMEOUT_MS };

export class ChatBusyError extends Error {}

const exchangeSelection = {
  id: chatExchanges.id,
  requestId: chatExchanges.requestId,
  chatId: chatExchanges.chatId,
  status: chatExchanges.status,
  phase: chatExchanges.phase,
  questionId: chatExchanges.questionId,
  deadlineAt: chatExchanges.deadlineAt,
  lastEventSeq: chatExchanges.lastEventSeq,
  error: chatExchanges.error,
};

type ExchangeRow = typeof chatExchanges.$inferSelect;

export const toExchangeSummary = (
  row: Pick<
    ExchangeRow,
    | 'id'
    | 'requestId'
    | 'status'
    | 'phase'
    | 'questionId'
    | 'deadlineAt'
    | 'lastEventSeq'
    | 'error'
  >,
): ChatExchangeSummary | null =>
  row.questionId === null
    ? null
    : {
        id: row.id,
        requestId: row.requestId,
        status: row.status,
        phase: row.phase,
        questionId: row.questionId,
        deadlineAt: row.deadlineAt,
        lastEventSeq: row.lastEventSeq,
        error: row.error,
      };

export const findExchangeByRequest = async (
  db: Db,
  workspaceId: number,
  requestId: string,
) =>
  (
    await db
      .select(exchangeSelection)
      .from(chatExchanges)
      .where(
        and(
          eq(chatExchanges.workspaceId, workspaceId),
          eq(chatExchanges.requestId, requestId),
        ),
      )
  )[0] ?? null;

export const latestExchange = async (db: Db, chatId: number) => {
  const row = (
    await db
      .select(exchangeSelection)
      .from(chatExchanges)
      .where(eq(chatExchanges.chatId, chatId))
      .orderBy(desc(chatExchanges.acceptedAt))
      .limit(1)
  )[0];
  return row ? toExchangeSummary(row) : null;
};

export const responseForExchange = async (
  db: Db,
  workspaceId: number,
  requestId: string,
): Promise<ChatStartResponse | null> => {
  const row = await findExchangeByRequest(db, workspaceId, requestId);
  const exchange = row ? toExchangeSummary(row) : null;
  if (!row || !exchange) {
    return null;
  }
  const [chat, question] = await Promise.all([
    db
      .select({ title: chats.title })
      .from(chats)
      .where(eq(chats.id, row.chatId))
      .then((rows) => rows[0]),
    db
      .select({
        id: chatMessages.id,
        role: chatMessages.role,
        content: chatMessages.content,
        createdAt: chatMessages.createdAt,
      })
      .from(chatMessages)
      .where(eq(chatMessages.id, exchange.questionId))
      .then((rows) => rows[0]),
  ]);
  if (!chat || question?.role !== 'user') {
    return null;
  }
  return {
    chatId: row.chatId,
    title: chat.title,
    exchange,
    question: { ...question, role: 'user' },
  };
};

export const acceptExchange = async (
  env: AppEnv,
  db: Db,
  input: {
    workspaceId: number;
    chatId: number;
    requestId: string;
    question: string;
    receivedAt: number;
  },
): Promise<ChatStartResponse> => {
  const exchangeId = crypto.randomUUID();
  const deadlineAt = input.receivedAt + CHAT_EXCHANGE_TIMEOUT_MS;
  try {
    await env.DB.batch([
      env.DB.prepare(
        `insert into chat_exchanges
          (id, request_id, chat_id, workspace_id, status, phase, deadline_at, accepted_at)
         select ?, ?, ?, ?, 'accepted', 'accepted', ?, ?
         from workspaces where id = ? and deleting_at is null`,
      ).bind(
        exchangeId,
        input.requestId,
        input.chatId,
        input.workspaceId,
        deadlineAt,
        input.receivedAt,
        input.workspaceId,
      ),
      env.DB.prepare(
        `insert into chat_messages
          (exchange_id, chat_id, role, content, created_at)
         values (?, ?, 'user', ?, ?)`,
      ).bind(exchangeId, input.chatId, input.question, input.receivedAt),
      env.DB.prepare(
        `update chat_exchanges
         set question_id = (
           select id from chat_messages
           where exchange_id = ? and role = 'user'
         )
         where id = ?`,
      ).bind(exchangeId, exchangeId),
      env.DB.prepare('update chats set updated_at = ? where id = ?').bind(
        input.receivedAt,
        input.chatId,
      ),
    ]);
  } catch (error) {
    const duplicate = await responseForExchange(
      db,
      input.workspaceId,
      input.requestId,
    );
    if (duplicate) {
      return duplicate;
    }
    const active = (
      await db
        .select({ id: chatExchanges.id })
        .from(chatExchanges)
        .where(
          and(
            eq(chatExchanges.chatId, input.chatId),
            eq(chatExchanges.workspaceId, input.workspaceId),
            eq(chatExchanges.status, 'running'),
          ),
        )
        .limit(1)
    )[0];
    const accepted =
      active ??
      (
        await db
          .select({ id: chatExchanges.id })
          .from(chatExchanges)
          .where(
            and(
              eq(chatExchanges.chatId, input.chatId),
              eq(chatExchanges.workspaceId, input.workspaceId),
              eq(chatExchanges.status, 'accepted'),
            ),
          )
          .limit(1)
      )[0];
    if (accepted) {
      throw new ChatBusyError('an answer is already running for this chat');
    }
    throw error;
  }
  const response = await responseForExchange(
    db,
    input.workspaceId,
    input.requestId,
  );
  if (!response) {
    throw new Error('could not load the accepted exchange');
  }
  return response;
};

export const messagesForExchange = async (db: Db, exchangeId: string) =>
  db
    .select(messageShape)
    .from(chatMessages)
    .where(eq(chatMessages.exchangeId, exchangeId))
    .orderBy(chatMessages.id);

const jsonValue = (value: unknown): string | null =>
  // JSON.stringify(undefined) returns undefined, and D1 rejects an undefined
  // bind outright, which would turn every failure commit into a 500.
  value == null ? null : JSON.stringify(value);

export const commitExchangeAnswer = async (
  env: AppEnv,
  db: Db,
  input: {
    exchangeId: string;
    chatId: number;
    exchange: Exchange;
    lastEventSeq: number;
  },
) => {
  const completedAt = Date.now();
  const sources =
    input.exchange.sources.length > 0 ? input.exchange.sources : null;
  const terminal = input.exchange.status;
  const matchesTerminal = `exists (
    select 1 from chat_exchanges
    where id = ? and status = ? and phase = 'terminal'
  )`;
  await env.DB.batch([
    env.DB.prepare(
      `insert into chat_messages
        (exchange_id, chat_id, role, content, panels, panel_data, links, steps,
         duration_ms, proposal, sources, evidence, selected_evidence_ids, created_at)
       select ?, ?, 'assistant', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       from chat_exchanges
       where id = ? and chat_id = ? and status = 'running'
         and phase = 'finalizing'
       on conflict(exchange_id, role) do nothing`,
    ).bind(
      input.exchangeId,
      input.chatId,
      input.exchange.content,
      jsonValue(input.exchange.panels),
      jsonValue(input.exchange.panelData),
      jsonValue(input.exchange.links),
      jsonValue(input.exchange.steps),
      input.exchange.durationMs,
      jsonValue(input.exchange.proposal),
      jsonValue(sources),
      jsonValue(input.exchange.evidence),
      jsonValue(input.exchange.selectedEvidenceIds),
      completedAt,
      input.exchangeId,
      input.chatId,
    ),
    env.DB.prepare(
      `update chat_exchanges
       set status = ?, phase = 'terminal', last_event_seq = ?,
           completed_at = ?, error = null
       where id = ? and chat_id = ? and status = 'running'
         and phase = 'finalizing'
         and exists (
           select 1 from chat_messages
           where exchange_id = ? and role = 'assistant' and content = ?
         )`,
    ).bind(
      terminal,
      input.lastEventSeq,
      completedAt,
      input.exchangeId,
      input.chatId,
      input.exchangeId,
      input.exchange.content,
    ),
    input.exchange.title
      ? env.DB.prepare(
          `update chats set title = ?, updated_at = ?
           where id = ? and ${matchesTerminal}`,
        ).bind(
          input.exchange.title,
          completedAt,
          input.chatId,
          input.exchangeId,
          terminal,
        )
      : env.DB.prepare(
          `update chats set updated_at = ?
           where id = ? and ${matchesTerminal}`,
        ).bind(completedAt, input.chatId, input.exchangeId, terminal),
  ]);
  const persisted = (
    await db
      .select({ status: chatExchanges.status })
      .from(chatExchanges)
      .where(eq(chatExchanges.id, input.exchangeId))
  )[0];
  return persisted?.status === terminal
    ? messagesForExchange(db, input.exchangeId)
    : null;
};

export const commitExchangeFailure = async (
  env: AppEnv,
  db: Db,
  input: {
    exchangeId: string;
    chatId: number;
    message: string;
    steps: { label: string; detail?: string }[];
    durationMs: number;
    status: 'failed' | 'cancelled';
    lastEventSeq?: number;
    fromStatuses?: ('accepted' | 'running')[];
    // A failed exchange still owes its evidence receipt: the lookups that ran
    // before the stop are auditable work, and losing them makes a timeout
    // indistinguishable from a dead end.
    evidence?: ChatEvidenceRecord[];
  },
): Promise<boolean> => {
  const completedAt = Date.now();
  const statuses = input.fromStatuses ?? ['accepted', 'running'];
  const placeholders = statuses.map(() => '?').join(', ');
  await env.DB.batch([
    env.DB.prepare(
      `insert into chat_messages
        (exchange_id, chat_id, role, content, panels, links, steps,
         duration_ms, evidence, selected_evidence_ids, created_at)
       select ?, ?, 'assistant', ?, '[]', '[]', ?, ?, ?, ?, '[]'
       from chat_exchanges
       where id = ? and chat_id = ? and status in (${placeholders})
       on conflict(exchange_id, role) do nothing`,
    ).bind(
      input.exchangeId,
      input.chatId,
      input.message,
      JSON.stringify(input.steps),
      input.durationMs,
      jsonValue(input.evidence),
      completedAt,
      input.exchangeId,
      input.chatId,
      ...statuses,
    ),
    env.DB.prepare(
      `update chat_exchanges
       set status = ?, phase = 'terminal',
           last_event_seq = coalesce(?, last_event_seq), completed_at = ?, error = ?
       where id = ? and chat_id = ? and status in (${placeholders})
         and exists (
           select 1 from chat_messages
           where exchange_id = ? and role = 'assistant' and content = ?
         )`,
    ).bind(
      input.status,
      input.lastEventSeq ?? null,
      completedAt,
      input.message,
      input.exchangeId,
      input.chatId,
      ...statuses,
      input.exchangeId,
      input.message,
    ),
    env.DB.prepare(
      `update chats set updated_at = ?
       where id = ? and exists (
         select 1 from chat_exchanges
         where id = ? and status = ? and phase = 'terminal' and error = ?
       )`,
    ).bind(
      completedAt,
      input.chatId,
      input.exchangeId,
      input.status,
      input.message,
    ),
  ]);
  const persisted = (
    await db
      .select({ status: chatExchanges.status, error: chatExchanges.error })
      .from(chatExchanges)
      .where(eq(chatExchanges.id, input.exchangeId))
  )[0];
  return (
    persisted?.status === input.status && persisted.error === input.message
  );
};

export const settleDispatchFailure = async (
  env: AppEnv,
  db: Db,
  workspaceId: number,
  response: ChatStartResponse,
): Promise<ChatStartResponse> => {
  await commitExchangeFailure(env, db, {
    exchangeId: response.exchange.id,
    chatId: response.chatId,
    message: 'The answer could not be started. Try again.',
    steps: [],
    durationMs: 0,
    status: 'failed',
    fromStatuses: ['accepted'],
  });
  return (
    (await responseForExchange(db, workspaceId, response.exchange.requestId)) ??
    response
  );
};

export const expireStaleExchanges = async (
  env: AppEnv,
  db: Db,
  workspaceId: number,
): Promise<void> => {
  const stale = await db
    .select({
      id: chatExchanges.id,
      chatId: chatExchanges.chatId,
      startedAt: chatExchanges.startedAt,
      acceptedAt: chatExchanges.acceptedAt,
    })
    .from(chatExchanges)
    .where(
      and(
        eq(chatExchanges.workspaceId, workspaceId),
        sql`${chatExchanges.status} in ('accepted', 'running')`,
        sql`${chatExchanges.deadlineAt} <= ${Date.now()}`,
      ),
    );
  for (const exchange of stale) {
    await commitExchangeFailure(env, db, {
      exchangeId: exchange.id,
      chatId: exchange.chatId,
      message: 'The answer took too long and was stopped. Try again.',
      steps: [],
      durationMs: Date.now() - (exchange.startedAt ?? exchange.acceptedAt),
      status: 'failed',
    });
  }
};
