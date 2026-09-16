import {
  type ChatScope,
  type ChatStartResponse,
  chatScopeSchema,
  isActiveChatExchange,
} from '@refd/core/chat';
import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { WorkspaceBindings } from '../auth/middleware';
import { HISTORY_MESSAGES, messageShape } from '../chat/exchange';
import {
  ChatExchangeRequestError,
  cancelExchange,
  purgeChatExchange,
  startExchange,
} from '../chat/exchange-do';
import {
  acceptExchange,
  ChatBusyError,
  expireStaleExchanges,
  latestExchange,
  responseForExchange,
  settleDispatchFailure,
} from '../chat/lifecycle';
import { type Db, getDb } from '../db/client';
import {
  type ChatProposal,
  chatExchanges,
  chatMessages,
  chats,
  entities,
} from '../db/schema';
import type { AppEnv } from '../env';
import { parseBody, parseId } from '../lib/http';
import { insertActivePrompt } from '../lib/prompt-limit';
import { domainField, multiLineText, singleLineText } from '../lib/sanitize';
import { configForUser } from '../lib/user-config';
import { buildChangeReport } from './changes';
import { buildDigest } from './digest';
import { buildSuggestions } from './suggestions';

export const chatRoutes = new Hono<WorkspaceBindings>();

// Model calls cost neurons; an owner-only surface still deserves a ceiling.
const MESSAGES_PER_HOUR = 30;
const TITLE_MAX = 80;
const messageSchema = z.object({
  message: multiLineText(1, 1000),
  requestId: z.string().uuid().optional(),
});

const overRateLimit = async (db: Db, workspaceId: number): Promise<boolean> => {
  const hourAgo = Date.now() - 60 * 60 * 1000;
  const recent = await db
    .select({ count: sql<number>`count(*)` })
    .from(chatMessages)
    .innerJoin(chats, eq(chatMessages.chatId, chats.id))
    .where(
      and(
        eq(chats.workspaceId, workspaceId),
        eq(chatMessages.role, 'user'),
        gte(chatMessages.createdAt, hourAgo),
      ),
    );
  return (recent[0]?.count ?? 0) >= MESSAGES_PER_HOUR;
};
// SSE plumbing: validation failures return plain JSON errors before this is

const ownedChat = async (db: Db, id: number, workspaceId: number) =>
  (
    await db
      .select()
      .from(chats)
      .where(and(eq(chats.id, id), eq(chats.workspaceId, workspaceId)))
  )[0];

const historyBefore = async (db: Db, chatId: number, questionId: number) =>
  (
    await db
      .select({ role: chatMessages.role, content: chatMessages.content })
      .from(chatMessages)
      .where(
        and(eq(chatMessages.chatId, chatId), lt(chatMessages.id, questionId)),
      )
      .orderBy(desc(chatMessages.id))
      .limit(HISTORY_MESSAGES)
  ).reverse();

const inheritedScopeBefore = async (
  db: Db,
  chatId: number,
  questionId: number,
): Promise<{ scope: ChatScope; messageId: number } | null> => {
  const row = (
    await db
      .select({ id: chatMessages.id, panelData: chatMessages.panelData })
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.chatId, chatId),
          eq(chatMessages.role, 'assistant'),
          lt(chatMessages.id, questionId),
        ),
      )
      .orderBy(desc(chatMessages.id))
      .limit(1)
  )[0];
  const panelData = row?.panelData;
  const parsed = chatScopeSchema.safeParse(panelData?._scope);
  return row && parsed.success
    ? { scope: parsed.data, messageId: row.id }
    : null;
};

const ensureExchangeStarted = async (
  env: AppEnv,
  db: Db,
  workspaceId: number,
  response: ChatStartResponse,
  withTitle: boolean,
  history?: { role: 'user' | 'assistant'; content: string }[],
): Promise<void> => {
  if (!isActiveChatExchange(response.exchange.status)) {
    return;
  }
  const inherited = await inheritedScopeBefore(
    db,
    response.chatId,
    response.exchange.questionId,
  );
  await startExchange(env, {
    exchangeId: response.exchange.id,
    chatId: response.chatId,
    workspaceId,
    history:
      history ??
      (await historyBefore(db, response.chatId, response.exchange.questionId)),
    question: response.question.content,
    withTitle,
    inheritedScope: inherited?.scope ?? null,
    inheritedFromMessageId: inherited?.messageId,
    receivedAt: response.question.createdAt,
    deadlineAt: response.exchange.deadlineAt,
  });
};

const startAcceptedExchange = async (
  env: AppEnv,
  db: Db,
  workspaceId: number,
  response: ChatStartResponse,
  withTitle: boolean,
  history?: { role: 'user' | 'assistant'; content: string }[],
): Promise<ChatStartResponse> => {
  try {
    await ensureExchangeStarted(
      env,
      db,
      workspaceId,
      response,
      withTitle,
      history,
    );
    return response;
  } catch (error) {
    console.error('chat exchange dispatch failed', error);
    return settleDispatchFailure(env, db, workspaceId, response);
  }
};

chatRoutes.get('/', async (c) => {
  const db = getDb(c.env);
  await expireStaleExchanges(c.env, db, c.get('workspace').id);
  const rows = await db
    .select({
      id: chats.id,
      title: chats.title,
      updatedAt: chats.updatedAt,
    })
    .from(chats)
    .where(eq(chats.workspaceId, c.get('workspace').id))
    .orderBy(desc(chats.updatedAt))
    .limit(50);
  const active =
    rows.length === 0
      ? []
      : await db
          .select({
            chatId: chatExchanges.chatId,
          })
          .from(chatExchanges)
          .where(
            and(
              inArray(
                chatExchanges.chatId,
                rows.map((chat) => chat.id),
              ),
              inArray(chatExchanges.status, ['accepted', 'running']),
            ),
          );
  const activeChats = new Set(active.map((row) => row.chatId));
  return c.json({
    chats: rows.map((chat) => ({
      ...chat,
      running: activeChats.has(chat.id),
    })),
  });
});

// Idle-state fuel: greeting name plus suggestion chips ranked from the
// workspace's actual state (routes/suggestions.ts holds the ranking rule).
// Each chip carries a number and names a thing; the canned starters only
// fill slots the measured candidates left empty.
const SUGGESTION_LIMIT = 4;

chatRoutes.get('/suggestions', async (c) => {
  const db = getDb(c.env);
  const ws = c.get('workspace').id;
  await expireStaleExchanges(c.env, db, ws);
  const digest = await buildDigest(db, ws);
  const name = c.get('user').firstName ?? c.get('user').email.split('@')[0];
  if (!digest) {
    return c.json({ name, brand: null, suggestions: [] });
  }
  const changes = await buildChangeReport(db, ws);
  const suggestions = buildSuggestions(
    digest.brand,
    digest.sections,
    changes?.status === 'ok' ? changes.events : [],
    SUGGESTION_LIMIT,
  );
  return c.json({
    name,
    brand: digest.brand,
    suggestions: suggestions.map(({ label, question, kind }) => ({
      label,
      question,
      kind,
    })),
  });
});

chatRoutes.post('/', async (c) => {
  const data = await parseBody(c, messageSchema);
  const db = getDb(c.env);
  const ws = c.get('workspace').id;
  const requestId = data.requestId ?? crypto.randomUUID();
  const duplicate = await responseForExchange(db, ws, requestId);
  if (duplicate) {
    const started = await startAcceptedExchange(c.env, db, ws, duplicate, true);
    return c.json(started, 202);
  }
  if (await overRateLimit(db, ws)) {
    return c.json({ error: 'chat limit reached (30 messages/hour)' }, 429);
  }
  const fallbackTitle =
    data.message.length > TITLE_MAX
      ? `${data.message.slice(0, TITLE_MAX - 1)}…`
      : data.message;
  const chat = (
    await db
      .insert(chats)
      .values({ workspaceId: ws, title: fallbackTitle })
      .returning({ id: chats.id, title: chats.title })
  )[0];
  if (!chat) {
    return c.json({ error: 'could not create chat' }, 500);
  }
  const receivedAt = Date.now();
  try {
    const accepted = await acceptExchange(c.env, db, {
      workspaceId: ws,
      chatId: chat.id,
      requestId,
      question: data.message,
      receivedAt,
    });
    const started = await startAcceptedExchange(
      c.env,
      db,
      ws,
      accepted,
      true,
      [],
    );
    if (started.chatId !== chat.id) {
      await db.delete(chats).where(eq(chats.id, chat.id));
    }
    return c.json(started, 202);
  } catch (error) {
    const accepted = await responseForExchange(db, ws, requestId);
    if (!accepted) {
      await db.delete(chats).where(eq(chats.id, chat.id));
    }
    if (error instanceof ChatBusyError) {
      return c.json({ error: error.message }, 409);
    }
    throw error;
  }
});

// Watch a chat's exchange: every event so far replays (steps, prose so far,
// or the terminal done/error for a finished exchange), then the socket stays
// open for live events until the exchange ends.
chatRoutes.get('/:id/exchanges/:exchangeId', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) {
    return c.json({ error: 'invalid id' }, 400);
  }
  const db = getDb(c.env);
  await expireStaleExchanges(c.env, db, c.get('workspace').id);
  const chat = await ownedChat(db, id, c.get('workspace').id);
  if (!chat) {
    return c.json({ error: 'not found' }, 404);
  }
  const exchangeId = c.req.param('exchangeId');
  const exchange = (
    await db
      .select({ id: chatExchanges.id })
      .from(chatExchanges)
      .where(
        and(
          eq(chatExchanges.id, exchangeId),
          eq(chatExchanges.chatId, id),
          eq(chatExchanges.workspaceId, c.get('workspace').id),
        ),
      )
  )[0];
  if (!exchange) {
    return c.json({ error: 'not found' }, 404);
  }
  const stub = c.env.CHAT_EXCHANGE.get(
    c.env.CHAT_EXCHANGE.idFromName(String(id)),
  );
  const url = new URL(c.req.url);
  url.searchParams.set('exchangeId', exchangeId);
  return stub.fetch(new Request(url, { headers: c.req.raw.headers }));
});

chatRoutes.get('/:id/exchange', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) {
    return c.json({ error: 'invalid id' }, 400);
  }
  const db = getDb(c.env);
  await expireStaleExchanges(c.env, db, c.get('workspace').id);
  const chat = await ownedChat(db, id, c.get('workspace').id);
  const exchange = chat ? await latestExchange(db, id) : null;
  if (!chat || !exchange) {
    return c.json({ error: 'not found' }, 404);
  }
  const stub = c.env.CHAT_EXCHANGE.get(
    c.env.CHAT_EXCHANGE.idFromName(String(id)),
  );
  const url = new URL(c.req.url);
  url.searchParams.set('exchangeId', exchange.id);
  return stub.fetch(new Request(url, { headers: c.req.raw.headers }));
});

chatRoutes.get('/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) {
    return c.json({ error: 'invalid id' }, 400);
  }
  const db = getDb(c.env);
  await expireStaleExchanges(c.env, db, c.get('workspace').id);
  const chat = await ownedChat(db, id, c.get('workspace').id);
  if (!chat) {
    return c.json({ error: 'not found' }, 404);
  }
  const messages = await db
    .select(messageShape)
    .from(chatMessages)
    .where(eq(chatMessages.chatId, id))
    .orderBy(chatMessages.id);
  const exchange = await latestExchange(db, id);
  return c.json({
    chatId: chat.id,
    title: chat.title,
    messages,
    exchange,
  });
});

chatRoutes.post('/:id/messages', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) {
    return c.json({ error: 'invalid id' }, 400);
  }
  const data = await parseBody(c, messageSchema);
  const db = getDb(c.env);
  const ws = c.get('workspace').id;
  await expireStaleExchanges(c.env, db, ws);
  const chat = await ownedChat(db, id, ws);
  if (!chat) {
    return c.json({ error: 'not found' }, 404);
  }
  const requestId = data.requestId ?? crypto.randomUUID();
  const duplicate = await responseForExchange(db, ws, requestId);
  if (duplicate) {
    if (duplicate.chatId !== id) {
      return c.json({ error: 'request id belongs to another chat' }, 409);
    }
    const started = await startAcceptedExchange(
      c.env,
      db,
      ws,
      duplicate,
      false,
    );
    return c.json(started, 202);
  }
  if (await overRateLimit(db, ws)) {
    return c.json({ error: 'chat limit reached (30 messages/hour)' }, 429);
  }
  const history = (
    await db
      .select({ role: chatMessages.role, content: chatMessages.content })
      .from(chatMessages)
      .where(eq(chatMessages.chatId, id))
      .orderBy(desc(chatMessages.id))
      .limit(HISTORY_MESSAGES)
  ).reverse();
  const receivedAt = Date.now();
  try {
    const accepted = await acceptExchange(c.env, db, {
      workspaceId: ws,
      chatId: id,
      requestId,
      question: data.message,
      receivedAt,
    });
    const started = await startAcceptedExchange(
      c.env,
      db,
      ws,
      accepted,
      false,
      history,
    );
    return c.json(started, 202);
  } catch (error) {
    if (error instanceof ChatBusyError) {
      return c.json({ error: error.message }, 409);
    }
    throw error;
  }
});

chatRoutes.post('/:id/exchanges/:exchangeId/cancel', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) {
    return c.json({ error: 'invalid id' }, 400);
  }
  const db = getDb(c.env);
  const exchangeId = c.req.param('exchangeId');
  const exchange = (
    await db
      .select({ id: chatExchanges.id, status: chatExchanges.status })
      .from(chatExchanges)
      .where(
        and(
          eq(chatExchanges.id, exchangeId),
          eq(chatExchanges.chatId, id),
          eq(chatExchanges.workspaceId, c.get('workspace').id),
        ),
      )
  )[0];
  if (!exchange) {
    return c.json({ error: 'not found' }, 404);
  }
  if (!isActiveChatExchange(exchange.status)) {
    return c.json({ ok: true });
  }
  try {
    await cancelExchange(c.env, id, exchangeId);
    return c.json({ ok: true });
  } catch (error) {
    if (error instanceof ChatExchangeRequestError) {
      return c.json({ error: error.message }, error.status === 404 ? 404 : 503);
    }
    throw error;
  }
});

// Confirmation gate for agent write proposals. Applying re-validates
// everything against the same rules as the dashboard routes (sanitizers,
// dedupe, caps) — the model's draft never touches the tables directly. A
// proposal resolves exactly once.
const proposalActionSchema = z.object({
  action: z.enum(['apply', 'dismiss']),
  // For prompt proposals: item indices to add. Empty = all items.
  selected: z.array(z.number().int().min(0)).max(50).default([]),
});

chatRoutes.post('/:id/messages/:messageId/proposal', async (c) => {
  const chatIdParam = parseId(c.req.param('id'));
  const messageId = parseId(c.req.param('messageId'));
  if (chatIdParam === null || messageId === null) {
    return c.json({ error: 'invalid id' }, 400);
  }
  const data = await parseBody(c, proposalActionSchema);
  const db = getDb(c.env);
  const ws = c.get('workspace').id;
  const chat = await ownedChat(db, chatIdParam, ws);
  if (!chat) {
    return c.json({ error: 'not found' }, 404);
  }
  const message = (
    await db
      .select()
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.id, messageId),
          eq(chatMessages.chatId, chatIdParam),
        ),
      )
  )[0];
  const proposal = message?.proposal;
  if (message?.role !== 'assistant' || !proposal) {
    return c.json({ error: 'no proposal on this message' }, 404);
  }
  if (proposal.status !== 'pending') {
    return c.json({ error: 'proposal already resolved' }, 409);
  }

  if (data.action === 'dismiss') {
    const updated: ChatProposal = { ...proposal, status: 'dismissed' };
    await db
      .update(chatMessages)
      .set({ proposal: updated })
      .where(eq(chatMessages.id, messageId));
    return c.json({ proposal: updated });
  }

  let summary: string;
  if (proposal.kind === 'prompts') {
    const promptLimit = configForUser(c.get('user').email, c.env.ADMIN_EMAILS)
      .limits.maxActivePromptsPerWorkspace;
    const chosen = [...new Set(data.selected)].filter(
      (i) => i >= 0 && i < proposal.items.length,
    );
    const indices =
      chosen.length > 0 ? chosen : proposal.items.map((_, i) => i);
    let added = 0;
    let skipped = 0;
    for (const index of indices) {
      const item = proposal.items[index];
      const parsedText = item
        ? multiLineText(8, 500).safeParse(item.text)
        : null;
      if (!item || !parsedText?.success) {
        skipped += 1;
        continue;
      }
      const insertedId = await insertActivePrompt(
        c.env,
        ws,
        parsedText.data,
        item.category ? [item.category] : [],
        promptLimit,
      );
      if (insertedId !== null) {
        added += 1;
      } else {
        skipped += 1;
      }
    }
    summary = `added ${added} prompt${added === 1 ? '' : 's'}${
      skipped > 0 ? `, ${skipped} skipped` : ''
    }`;
  } else {
    const parsedCompetitor = z
      .object({
        name: singleLineText(1, 100),
        domains: z.array(domainField()).min(1).max(10),
        aliases: z
          .array(
            z.object({
              value: singleLineText(1, 60),
              caseSensitive: z.boolean().optional(),
            }),
          )
          .max(10),
      })
      .safeParse({
        name: proposal.name,
        domains: proposal.domains,
        aliases: proposal.aliases,
      });
    if (!parsedCompetitor.success) {
      return c.json({ error: 'proposal is no longer valid' }, 422);
    }
    const existing = await db
      .select()
      .from(entities)
      .where(eq(entities.workspaceId, ws));
    const maxOrder = existing.reduce(
      (max, e) => Math.max(max, e.sortOrder),
      -1,
    );
    const inserted = await db
      .insert(entities)
      .values({
        workspaceId: ws,
        name: parsedCompetitor.data.name,
        domains: parsedCompetitor.data.domains,
        aliases: parsedCompetitor.data.aliases,
        isBrand: false,
        sortOrder: maxOrder + 1,
      })
      .onConflictDoNothing({ target: [entities.workspaceId, entities.name] })
      .returning({ id: entities.id });
    summary = inserted[0]
      ? `added ${parsedCompetitor.data.name} as a competitor`
      : `${parsedCompetitor.data.name} is already tracked`;
  }

  const updated: ChatProposal = { ...proposal, status: 'applied', summary };
  await db
    .update(chatMessages)
    .set({ proposal: updated })
    .where(eq(chatMessages.id, messageId));
  return c.json({ proposal: updated });
});

chatRoutes.delete('/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) {
    return c.json({ error: 'invalid id' }, 400);
  }
  const db = getDb(c.env);
  const chat = await ownedChat(db, id, c.get('workspace').id);
  if (!chat) {
    return c.json({ error: 'not found' }, 404);
  }
  await purgeChatExchange(c.env, id);
  await db.delete(chatMessages).where(eq(chatMessages.chatId, id));
  await db.delete(chatExchanges).where(eq(chatExchanges.chatId, id));
  await db.delete(chats).where(eq(chats.id, id));
  return c.json({ ok: true });
});
