import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { WorkspaceBindings } from '../auth/middleware';
import {
  HISTORY_MESSAGES,
  messageShape,
  storeQuestion,
} from '../chat/exchange';
import { startExchange } from '../chat/exchange-do';
import { type Db, getDb } from '../db/client';
import { type ChatProposal, chatMessages, chats, entities } from '../db/schema';
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
// How long an unanswered question may still read as running. Comfortably past
// the object's own 5-minute alarm, which writes a failure row of its own.
const RUNNING_MAX_MS = 10 * 60 * 1000;

const messageSchema = z.object({ message: multiLineText(1, 1000) });

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

chatRoutes.get('/', async (c) => {
  const db = getDb(c.env);
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
  // Every finished exchange writes exactly one question and one answer, so a
  // chat with more questions than answers still has one in flight. Counted in
  // a grouped query rather than a correlated subquery, which Drizzle's sql
  // template does not correlate the way raw SQL does.
  const counts =
    rows.length === 0
      ? []
      : await db
          .select({
            chatId: chatMessages.chatId,
            questions: sql<number>`sum(case when ${chatMessages.role} = 'user' then 1 else 0 end)`,
            answers: sql<number>`sum(case when ${chatMessages.role} = 'assistant' then 1 else 0 end)`,
          })
          .from(chatMessages)
          .where(
            inArray(
              chatMessages.chatId,
              rows.map((chat) => chat.id),
            ),
          )
          .groupBy(chatMessages.chatId);
  const unanswered = new Map(
    counts.map((row) => [row.chatId, row.questions - row.answers]),
  );
  // An exchange that died without writing anything (an evicted object, say)
  // would otherwise spin forever. The alarm writes a failure row well inside
  // this window, so past it an unanswered question is stalled, not running.
  const stallCutoff = Date.now() - RUNNING_MAX_MS;
  return c.json({
    chats: rows.map((chat) => ({
      ...chat,
      running:
        (unanswered.get(chat.id) ?? 0) > 0 && chat.updatedAt > stallCutoff,
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
  // The question is persisted before the model runs, so the chat exists the
  // moment it is sent: navigating away keeps it, and a run that dies leaves a
  // thread that still shows what was asked.
  const receivedAt = Date.now();
  const question = await storeQuestion(db, chat.id, data.message, receivedAt);
  await startExchange(c.env, {
    chatId: chat.id,
    workspaceId: ws,
    history: [],
    question: data.message,
    withTitle: true,
    receivedAt,
  });
  return c.json({ chatId: chat.id, title: chat.title, question });
});

// Watch a chat's exchange: every event so far replays (steps, prose so far,
// or the terminal done/error for a finished exchange), then the socket stays
// open for live events until the exchange ends.
chatRoutes.get('/:id/exchange', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) {
    return c.json({ error: 'invalid id' }, 400);
  }
  const db = getDb(c.env);
  const chat = await ownedChat(db, id, c.get('workspace').id);
  if (!chat) {
    return c.json({ error: 'not found' }, 404);
  }
  const stub = c.env.CHAT_EXCHANGE.get(
    c.env.CHAT_EXCHANGE.idFromName(String(id)),
  );
  return stub.fetch(c.req.raw);
});

chatRoutes.get('/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) {
    return c.json({ error: 'invalid id' }, 400);
  }
  const db = getDb(c.env);
  const chat = await ownedChat(db, id, c.get('workspace').id);
  if (!chat) {
    return c.json({ error: 'not found' }, 404);
  }
  const messages = await db
    .select(messageShape)
    .from(chatMessages)
    .where(eq(chatMessages.chatId, id))
    .orderBy(chatMessages.id);
  return c.json({ chatId: chat.id, title: chat.title, messages });
});

chatRoutes.post('/:id/messages', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) {
    return c.json({ error: 'invalid id' }, 400);
  }
  const data = await parseBody(c, messageSchema);
  const db = getDb(c.env);
  const ws = c.get('workspace').id;
  const chat = await ownedChat(db, id, ws);
  if (!chat) {
    return c.json({ error: 'not found' }, 404);
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
  const question = await storeQuestion(db, id, data.message, receivedAt);
  await startExchange(c.env, {
    chatId: id,
    workspaceId: ws,
    history,
    question: data.message,
    withTitle: false,
    receivedAt,
  });
  return c.json({ ok: true, question });
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
  await db.delete(chatMessages).where(eq(chatMessages.chatId, id));
  await db.delete(chats).where(eq(chats.id, id));
  return c.json({ ok: true });
});
