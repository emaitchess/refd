import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { WorkspaceBindings } from '../auth/middleware';
import { type Db, getDb } from '../db/client';
import {
  type ChatLink,
  type ChatProposal,
  type ChatStep,
  type ChatWebSource,
  chatMessages,
  chats,
  entities,
} from '../db/schema';
import type { AppEnv } from '../env';
import type { WebResult } from '../lib/exa';
import { parseBody, parseId } from '../lib/http';
import {
  llmText,
  PLANNING_MODEL,
  PROMPT_CATEGORIES,
  parseJson,
  runChat,
  runChatStream,
  runChatWithTools,
} from '../lib/llm';
import { insertActivePrompt } from '../lib/prompt-limit';
import { detectRange } from '../lib/range';
import { domainField, multiLineText, singleLineText } from '../lib/sanitize';
import { configForUser } from '../lib/user-config';
import { executeTool } from './agent-tools';
import { buildChangeReport } from './changes';
import { buildDigest, DIGEST_PANELS, type DigestPanel } from './digest';
import { buildSuggestions } from './suggestions';
import {
  type AgentTool,
  agentTool,
  availableTools,
  toolDefinition,
} from './tool-registry';

export const chatRoutes = new Hono<WorkspaceBindings>();

// Model calls cost neurons; an owner-only surface still deserves a ceiling.
const MESSAGES_PER_HOUR = 30;
// Conversation context sent back to the model (user + assistant turns).
const HISTORY_MESSAGES = 8;
const TITLE_MAX = 80;

const messageSchema = z.object({ message: multiLineText(1, 1000) });

// The only places an answer may link to. Anything else the model proposes is
// dropped, never rendered — a chat answer must not become an open redirect.
const LINK_PREFIXES = [
  '/overview',
  '/competitors',
  '/prompts',
  '/sources',
  '/runs',
  '/help',
];
const validLink = (to: string): boolean =>
  LINK_PREFIXES.some(
    (p) => to === p || to.startsWith(`${p}/`) || to.startsWith(`${p}?`),
  );

const metaSchema = z.object({
  // Only requested on a conversation's first exchange; absent otherwise.
  title: llmText(60).catch(''),
  panels: z.array(z.string().catch('')).catch([]),
  links: z
    .array(
      z
        .object({
          label: llmText(48).pipe(z.string().min(1)),
          to: z.string(),
        })
        .nullable()
        .catch(null),
    )
    .catch([]),
  // Write draft: shown as a confirmation card, never applied by the model.
  proposal: z
    .object({
      kind: z.enum(['prompts', 'competitor']),
      items: z
        .array(
          z
            .object({
              text: llmText(500).catch(''),
              category: llmText(40).catch(''),
            })
            .nullable()
            .catch(null),
        )
        .catch([]),
      name: llmText(100).catch(''),
      domains: z.array(z.string().catch('')).catch([]),
      aliases: z
        .array(
          z
            .object({
              value: llmText(60),
              caseSensitive: z.boolean().catch(false),
            })
            .nullable()
            .catch(null),
        )
        .catch([]),
    })
    .nullable()
    .catch(null),
  // Which gathered web results the answer actually used (1-based numbers).
  webSources: z.array(z.number().int().catch(0)).catch([]),
});

const PROMPT_CATEGORY_SET = new Set<string>(PROMPT_CATEGORIES);

// Server-side laundering of the model's proposal draft: only well-formed,
// non-trivial content survives; an empty survivor means no proposal at all.
const toProposal = (
  meta: z.infer<typeof metaSchema> | null,
): ChatProposal | null => {
  const p = meta?.proposal;
  if (!p) {
    return null;
  }
  if (p.kind === 'prompts') {
    const items = p.items
      .flatMap((item) => (item ? [item] : []))
      .map((item) => ({
        text: item.text.trim(),
        ...(PROMPT_CATEGORY_SET.has(item.category)
          ? { category: item.category }
          : {}),
      }))
      .filter((item) => item.text.length >= 8)
      .slice(0, 10);
    return items.length > 0
      ? { kind: 'prompts', items, status: 'pending' }
      : null;
  }
  const name = p.name.trim();
  const domains = [
    ...new Set(
      p.domains
        .map((d) => d.trim().toLowerCase())
        .filter((d) => domainField().safeParse(d).success),
    ),
  ].slice(0, 10);
  const aliases = p.aliases
    .flatMap((alias) => (alias ? [alias] : []))
    .map((alias) => ({
      value: alias.value.trim(),
      ...(alias.caseSensitive ? { caseSensitive: true } : {}),
    }))
    .filter((alias) => alias.value.length > 0)
    .slice(0, 10);
  return name.length > 0 && domains.length > 0
    ? { kind: 'competitor', name, domains, aliases, status: 'pending' }
    : null;
};

// Planning phase: the model picks tools natively, and tool calls and prose
// arrive in different fields of the response, so a tool call can never be
// mistaken for an answer. The planning model's own final prose is discarded;
// what the user sees is written by the answer phase.
const systemPlanning =
  'You are the refd workspace agent, in the information-gathering phase. ' +
  'refd monitors how AI search surfaces (ChatGPT, Perplexity, Gemini, ' +
  'Google AI Mode, Google AI Overviews) mention, cite, and rank the ' +
  'workspace brand.\n' +
  'The workspace data JSON is provided; call tools for anything it does not ' +
  'already cover.\n' +
  'Rules:\n' +
  '- If the user asks what a specific AI answer said, or about one tracked ' +
  "prompt's results, call get_prompt_results first, then read_answer with a " +
  'resultId it returned.\n' +
  '- If the question needs information from the public web (other companies, ' +
  'reviews, trends, research for drafting), call search_web.\n' +
  '- For questions spanning many prompts, surfaces, or dates, prefer one ' +
  'query_results or aggregate call over repeated get_prompt_results calls.\n' +
  '- Never repeat a call with identical arguments.\n' +
  '- When the gathered information is enough, stop calling tools and reply ' +
  'with one short plain-text sentence; the real answer is written ' +
  'afterwards from the evidence you gathered.';

export type ParsedToolCall =
  | { ok: true; args: unknown }
  | { ok: false; error: string };

// A tool call's arguments are model output: JSON.parse in a try/catch, then
// the registry schema. Unknown keys are stripped (the z.object default), so
// an over-eager extra argument is harmless rather than fatal.
export const parseToolCall = (
  tool: AgentTool,
  rawArguments: string,
): ParsedToolCall => {
  let value: unknown;
  try {
    value = JSON.parse(rawArguments);
  } catch {
    return { ok: false, error: 'arguments were not valid JSON' };
  }
  const parsed = tool.args.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map(
        (issue) => `${issue.path.join('.') || 'arguments'}: ${issue.message}`,
      )
      .join('; ');
    return { ok: false, error: `arguments failed validation (${issues})` };
  }
  return { ok: true, args: parsed.data };
};

const systemPrompt = (): string =>
  'You are the refd workspace assistant. refd monitors how AI search surfaces ' +
  '(ChatGPT, Perplexity, Gemini, Google AI Mode, Google AI Overviews) mention, ' +
  'cite, and rank the workspace brand against tracked competitors.\n' +
  'Answer the user using the workspace data and the gathered evidence. Rules:\n' +
  '- Never invent numbers, brands, or facts absent from the data. If the data ' +
  'cannot answer, say so plainly and name what it can answer instead.\n' +
  '- Rates are 0..1 fractions; write them as percentages. null means "no data ' +
  'yet", never zero.\n' +
  '- "Mentioned" (named in answer text) and "cited" (own domain in sources) ' +
  'are independent signals. A missing Google AI Overview is normal. Sentiment ' +
  'values are shares of classified mentions only.\n' +
  '- Write 2 to 5 sentences of plain markdown prose, no headings and no JSON ' +
  'in the prose. Do not recite whole tables; the app renders the supporting ' +
  'data panels alongside your answer.\n' +
  '- Web results in the evidence are numbered S1, S2, ...: cite one in prose ' +
  'like (S2) only if you actually used it. The other numbered items are tool ' +
  'results, never citations; when there are no web results, use no citation ' +
  'markers.\n' +
  '- Never mention tools, traces, or metadata in the prose.';

// Model-written titles arrive with stray quotes and whitespace often enough
// to launder them; empty after cleaning = no title, caller keeps its fallback.
const cleanTitle = (raw: string): string | null => {
  const cleaned = raw
    .replace(/\s+/g, ' ')
    .replace(/^["'“”\s]+|["'“”.\s]+$/g, '')
    .trim();
  return cleaned.length > 0 ? cleaned.slice(0, 60) : null;
};

interface Exchange {
  content: string;
  title: string | null;
  panels: DigestPanel[];
  panelData: Record<string, unknown> | null;
  links: ChatLink[];
  steps: ChatStep[];
  durationMs: number;
  proposal: ChatProposal | null;
  sources: ChatWebSource[];
}

// Weighted ceiling on gathering per exchange. A cheap D1 aggregate should not
// cost the same as an R2 read or a page fetch.
const TOOL_BUDGET = 30;
// Hard bound on planning round trips, so a misbehaving model cannot spin
// forever even if every call it makes is free.
const MAX_PLANNING_ROUNDS = 20;
// Shown when the answer phase produces no prose at all.
const ANSWER_FALLBACK =
  'I could not put together a grounded answer for that. Try rephrasing the question, or open Overview for the numbers directly.';

export type ParsedMeta = z.infer<typeof metaSchema>;

// Extraction brief for the metadata call. The json_schema bounds the shape;
// this bounds the values. metaSchema and the laundering below remain the
// security boundary.
const metaPrompt = (withTitle: boolean, sourceCount: number): string =>
  'You read a finished assistant answer and extract structured metadata for ' +
  'the app to render. Return ONLY the JSON object the response schema asks ' +
  'for, copying values from the answer and never inventing them.\n' +
  (withTitle
    ? '- title: a crisp name for this conversation, at most 6 plain words ' +
      'naming the topic, no quotes and no trailing punctuation.\n'
    : '') +
  `- panels: up to 2 section keys from [${DIGEST_PANELS.join(', ')}] whose ` +
  'data supports the answer; [] if none apply.\n' +
  '- links: up to 2 dashboard links (objects {"label", "to"}) from ' +
  '/overview, /competitors, /prompts, /sources, /runs with short labels; ' +
  '[] if none apply.\n' +
  '- proposal: ONLY when the answer drafts prompts or a competitor for the ' +
  'user to confirm, else null. Shape: {"kind":"prompts","items":[{"text":' +
  `string,"category":one of ${PROMPT_CATEGORIES.join('|')}]}] with 3 to 10 ` +
  'natural buyer questions (8..500 chars each, most NOT naming the brand), ' +
  'or {"kind":"competitor","name":string,"domains":[apex domains verified ' +
  'in real results],"aliases":[{"value":string,"caseSensitive":boolean}]}. ' +
  'The app shows proposals for human confirmation; never claim anything ' +
  'was added.\n' +
  (sourceCount > 0
    ? `- webSources: the numbers (1..${sourceCount}) of the web results the ` +
      'answer cited or used; [] if none.'
    : '- webSources: the answer had no web results, so this is always [].');

const metaResponseFormat = (withTitle: boolean) => ({
  type: 'json_schema' as const,
  json_schema: {
    name: 'meta',
    schema: {
      type: 'object',
      properties: {
        ...(withTitle ? { title: { type: 'string' } } : {}),
        panels: { type: 'array', items: { type: 'string' } },
        links: {
          type: 'array',
          items: {
            type: 'object',
            properties: { label: { type: 'string' }, to: { type: 'string' } },
            required: ['label', 'to'],
            additionalProperties: false,
          },
        },
        proposal: { type: ['object', 'null'] },
        webSources: { type: 'array', items: { type: 'number' } },
      },
      required: [
        ...(withTitle ? ['title'] : []),
        'panels',
        'links',
        'proposal',
        'webSources',
      ],
      additionalProperties: false,
    },
  },
});

// Structured extras arrive from a separate, small, non-streamed call after the
// prose: the answer model streams pure prose, so protocol output can never
// leak into it. Any failure degrades to no metadata, never to a lost answer.
const extractMeta = async (
  env: AppEnv,
  question: string,
  prose: string,
  withTitle: boolean,
  sourceCount: number,
): Promise<ParsedMeta | null> => {
  try {
    const raw = await runChat(
      env,
      [
        {
          role: 'system' as const,
          content: metaPrompt(withTitle, sourceCount),
        },
        {
          role: 'user' as const,
          content: `Question:\n${question}\n\nAnswer:\n${prose.slice(0, 5000)}`,
        },
      ],
      {
        model: PLANNING_MODEL,
        maxTokens: 2000,
        responseFormat: metaResponseFormat(withTitle),
      },
    );
    return parseJson(raw, metaSchema);
  } catch {
    return null;
  }
};

type StreamEvent =
  | { type: 'step'; label: string; detail?: string }
  | { type: 'delta'; text: string }
  | {
      type: 'done';
      chatId: number;
      title: string;
      messages: unknown[];
    }
  | { type: 'error'; message: string };

type Emit = (event: StreamEvent) => Promise<void>;

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

// Run one grounded exchange, streaming honest progress: real pipeline stages
// with real counts, prose deltas as the model writes them, and structured
// metadata extracted by a separate call so it can never leak into the prose.
const streamExchange = async (
  env: AppEnv,
  db: Db,
  workspaceId: number,
  history: { role: 'user' | 'assistant'; content: string }[],
  question: string,
  opts: { withTitle?: boolean },
  emit: Emit,
): Promise<Exchange> => {
  const started = Date.now();
  const steps: ChatStep[] = [];
  const step = async (label: string, detail?: string) => {
    steps.push(detail === undefined ? { label } : { label, detail });
    await emit({ type: 'step', label, detail });
  };

  // Default 30 days; the question's own words can pick another window
  // ("past 7 days", "all time") — disclosed in the step trace either way.
  const range = detectRange(question) ?? '30d';
  const digest = await buildDigest(db, workspaceId, range);
  if (!digest) {
    const content =
      'This workspace is not set up yet, so there is no data to talk to. Finish onboarding first.';
    await emit({ type: 'delta', text: content });
    return {
      content,
      title: null,
      panels: [],
      panelData: null,
      links: [],
      steps,
      durationMs: Date.now() - started,
      proposal: null,
      sources: [],
    };
  }
  const sections = digest.sections as {
    surfaces: unknown[];
    competitors: unknown[];
    runs: unknown[];
    prompts: { tracked: number };
    sources: { topCited: unknown[]; gap: unknown[] };
  };
  await step(
    'read the workspace snapshot',
    `${digest.rangeLabel} · ${sections.surfaces.length} surfaces · ` +
      `${sections.competitors.length} entities · ${sections.prompts.tracked} prompts · ` +
      `${sections.runs.length} runs · ${sections.sources.topCited.length + sections.sources.gap.length} source domains`,
  );

  const dataMessage = {
    role: 'system' as const,
    content: `Workspace data for ${digest.brand}, ${digest.rangeLabel}:\n${JSON.stringify(digest.sections)}`,
  };
  // The conversation the user can see. It never carries protocol JSON, so the
  // answer phase can be handed it verbatim.
  const conversation: { role: 'user' | 'assistant'; content: string }[] = [
    ...history.slice(-HISTORY_MESSAGES),
    { role: 'user' as const, content: question },
  ];
  const evidence: string[] = [];
  const hasWebSearch = Boolean(env.EXA_API_KEY);
  const tools = availableTools(hasWebSearch);
  const toolDefs = tools.map(toolDefinition);
  const allSources: WebResult[] = [];
  const seenCalls = new Set<string>();
  const toolMessages: unknown[] = [];
  let spent = 0;
  let rounds = 0;
  const toolsUsed = () =>
    `${evidence.length} ${evidence.length === 1 ? 'tool' : 'tools'} used`;

  for (;;) {
    const turn = await runChatWithTools(
      env,
      [
        { role: 'system' as const, content: systemPlanning },
        dataMessage,
        ...conversation,
        ...toolMessages,
      ],
      toolDefs,
      // No ceiling: a cap only ever truncates the reasoning the turn needs.
      { model: PLANNING_MODEL, maxTokens: null },
    );
    if (turn.finishReason !== 'tool_calls' || turn.toolCalls.length === 0) {
      await step('finished gathering', toolsUsed());
      break;
    }
    // Echo the assistant turn verbatim, then answer every call in order.
    toolMessages.push({ role: 'assistant', tool_calls: turn.rawToolCalls });
    for (const call of turn.toolCalls) {
      const tool = agentTool(call.name);
      if (!tool) {
        await step('unknown tool requested', call.name.slice(0, 40));
        toolMessages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: `Unknown tool "${call.name}". Available tools: ${tools
            .map((t) => t.name)
            .join(', ')}.`,
        });
        continue;
      }
      const parsed = parseToolCall(tool, call.rawArguments);
      if (!parsed.ok) {
        await step(`${tool.name} skipped`, 'invalid arguments');
        toolMessages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: `Tool ${tool.name} was not run: ${parsed.error}. Correct the arguments and try again, or use a different tool.`,
        });
        continue;
      }
      const callKey = `${tool.name}:${JSON.stringify(parsed.args)}`;
      if (seenCalls.has(callKey)) {
        await step('skipped a repeated lookup', tool.name);
        toolMessages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: `You already ran ${tool.name} with these exact arguments. Choose a different call, or stop calling tools when you have enough.`,
        });
        continue;
      }
      seenCalls.add(callKey);
      const outcome = await executeTool(
        env,
        workspaceId,
        tool.name,
        parsed.args,
        allSources.length,
      );
      if (outcome.sources) {
        allSources.push(...outcome.sources);
      }
      await step(outcome.label, outcome.detail);
      toolMessages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: outcome.result,
      });
      evidence.push(
        `${evidence.length + 1}. ${tool.name}(${JSON.stringify(parsed.args)})\n${outcome.result}`,
      );
      spent += tool.cost;
    }
    if (spent >= TOOL_BUDGET) {
      await step('reached the tool budget', toolsUsed());
      break;
    }
    rounds += 1;
    if (rounds >= MAX_PLANNING_ROUNDS) {
      await step('reached the planning round limit', toolsUsed());
      break;
    }
  }

  // The answer phase sees the evidence as data, never as assistant turns.
  // Replaying planning turns here taught the model that this assistant
  // speaks JSON, and it obligingly emitted another tool call as its answer.
  const messages = [
    { role: 'system' as const, content: systemPrompt() },
    dataMessage,
    ...(evidence.length === 0
      ? []
      : [
          {
            role: 'system' as const,
            content: `Evidence gathered for this question:\n${evidence.join('\n\n')}`,
          },
        ]),
    ...conversation,
  ];
  await step('writing the answer', 'grounded to the gathered evidence only');

  let prose = '';
  await runChatStream(env, messages, { maxTokens: 2000 }, async (delta) => {
    if (!delta) {
      return;
    }
    prose += delta;
    await emit({ type: 'delta', text: delta });
  });

  const meta = await extractMeta(
    env,
    question,
    prose,
    opts.withTitle === true,
    allSources.length,
  );
  // Only web results the answer says it used become cited sources.
  const sources: ChatWebSource[] = [...new Set(meta?.webSources ?? [])]
    .filter((n) => n >= 1 && n <= allSources.length)
    .slice(0, 6)
    .flatMap((n) => {
      const source = allSources[n - 1];
      // num keeps the S-number the prose cites; the stored list is a subset.
      return source ? [{ title: source.title, url: source.url, num: n }] : [];
    });
  const panels = [
    ...new Set(
      (meta?.panels ?? []).filter((p): p is DigestPanel =>
        (DIGEST_PANELS as readonly string[]).includes(p),
      ),
    ),
  ].slice(0, 2);
  const links = (meta?.links ?? [])
    .filter((l): l is NonNullable<typeof l> => l !== null && validLink(l.to))
    .slice(0, 2);
  const durationMs = Date.now() - started;
  await step(
    panels.length > 0
      ? `selected evidence panels: ${panels.join(', ')}`
      : 'no evidence panels apply',
    `${seconds(durationMs)}${sources.length > 0 ? ` · ${sources.length} web sources cited` : ''}`,
  );

  const content = prose.trim().slice(0, 4000) || ANSWER_FALLBACK;
  return {
    content,
    title: opts.withTitle === true ? cleanTitle(meta?.title ?? '') : null,
    panels,
    // _window rides along so panels keep displaying the window they were
    // answered under, even when a later default differs.
    panelData:
      panels.length > 0
        ? {
            _window: digest.rangeLabel,
            ...Object.fromEntries(panels.map((p) => [p, digest.sections[p]])),
          }
        : null,
    links,
    steps,
    durationMs,
    proposal: toProposal(meta),
    sources,
  };
};

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

const messageShape = {
  id: chatMessages.id,
  role: chatMessages.role,
  content: chatMessages.content,
  panels: chatMessages.panels,
  panelData: chatMessages.panelData,
  links: chatMessages.links,
  steps: chatMessages.steps,
  durationMs: chatMessages.durationMs,
  proposal: chatMessages.proposal,
  sources: chatMessages.sources,
  createdAt: chatMessages.createdAt,
};

const storeExchange = async (
  db: Db,
  chatId: number,
  question: string,
  exchange: Exchange,
  // Both rows insert after the model answers, so the user row carries the
  // request-arrival time explicitly: sent time, not completion time.
  receivedAt: number,
) => {
  const inserted = await db
    .insert(chatMessages)
    .values([
      { chatId, role: 'user', content: question, createdAt: receivedAt },
      {
        chatId,
        role: 'assistant',
        content: exchange.content,
        panels: exchange.panels,
        panelData: exchange.panelData,
        links: exchange.links,
        steps: exchange.steps,
        durationMs: exchange.durationMs,
        proposal: exchange.proposal,
        sources: exchange.sources.length > 0 ? exchange.sources : null,
        createdAt: Date.now(),
      },
    ])
    .returning(messageShape);
  await db
    .update(chats)
    .set({ updatedAt: Date.now() })
    .where(eq(chats.id, chatId));
  return inserted;
};

// SSE plumbing: validation failures return plain JSON errors before this is
// called; once streaming starts, failures travel as an in-stream error event.
const sseResponse = (
  c: { executionCtx: { waitUntil: (p: Promise<unknown>) => void } },
  produce: (emit: Emit) => Promise<void>,
): Response => {
  const { readable, writable } = new TransformStream<Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const emit: Emit = async (event) => {
    await writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
  };
  c.executionCtx.waitUntil(
    (async () => {
      try {
        await produce(emit);
      } catch (error) {
        console.error('chat stream failure', error);
        await emit({
          type: 'error',
          message: 'The answer failed partway. Try again.',
        }).catch(() => {});
      } finally {
        await writer.close().catch(() => {});
      }
    })(),
  );
  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  });
};

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
    .select({ id: chats.id, title: chats.title, updatedAt: chats.updatedAt })
    .from(chats)
    .where(eq(chats.workspaceId, c.get('workspace').id))
    .orderBy(desc(chats.updatedAt))
    .limit(50);
  return c.json({ chats: rows });
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
  const receivedAt = Date.now();
  return sseResponse(c, async (emit) => {
    const exchange = await streamExchange(
      c.env,
      db,
      ws,
      [],
      data.message,
      { withTitle: true },
      emit,
    );
    const messages = await storeExchange(
      db,
      chat.id,
      data.message,
      exchange,
      receivedAt,
    );
    // The model named the conversation alongside its answer; the truncated
    // first message stays as the fallback when it did not.
    const finalTitle = exchange.title ?? chat.title;
    if (exchange.title) {
      await db
        .update(chats)
        .set({ title: exchange.title })
        .where(eq(chats.id, chat.id));
    }
    await emit({ type: 'done', chatId: chat.id, title: finalTitle, messages });
  });
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
  return sseResponse(c, async (emit) => {
    const exchange = await streamExchange(
      c.env,
      db,
      ws,
      history,
      data.message,
      {},
      emit,
    );
    const messages = await storeExchange(
      db,
      id,
      data.message,
      exchange,
      receivedAt,
    );
    await emit({ type: 'done', chatId: id, title: chat.title, messages });
  });
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
