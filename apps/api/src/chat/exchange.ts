// The grounded exchange engine, driven by the ChatExchange durable object:
// the planning loop, the answer phase, and the D1 persistence of the finished
// rows. The DO owns the live transport; this file owns what it streams.
// Deliberately free of durable-object types so the engine stays portable.
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import {
  type ChatLink,
  type ChatProposal,
  type ChatStep,
  type ChatWebSource,
  chatMessages,
  chats,
} from '../db/schema';
import type { AppEnv } from '../env';
import type { WebResult } from '../lib/exa';
import {
  llmText,
  PLANNING_MODEL,
  PROMPT_CATEGORIES,
  parseJson,
  runChat,
  runChatStream,
  runChatWithTools,
} from '../lib/llm';
import { detectRange } from '../lib/range';
import { domainField } from '../lib/sanitize';
import { executeTool } from '../routes/agent-tools';
import { buildDigest, DIGEST_PANELS, type DigestPanel } from '../routes/digest';
import {
  type AgentTool,
  availableTools,
  offeredTool,
  toolDefinition,
} from '../routes/tool-registry';

// Conversation context sent back to the model (user + assistant turns).
export const HISTORY_MESSAGES = 8;

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

export interface Exchange {
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
// Generous but bounded. glm-5.3 bills its reasoning pass against the same
// completion budget, so a tight ceiling truncates or erases the answer rather
// than shortening it: measured on an 87-row evidence payload, 2000 finished
// with reason "length" while 8000 and above finished clean. Uncapped also
// works but leaves nothing bounding a runaway turn on a user-facing stream.
const ANSWER_TOKEN_CEILING = 16000;
// Wall-clock bound on one answer draw. glm-5.3 normally writes this payload
// in under 10 seconds, but a bad draw can reason for minutes without emitting
// a token, and in prod one consumed the object's whole 5-minute alarm. Two
// attempts still finish comfortably inside it.
const EVIDENCE_PREFIX = 'Evidence gathered for this question:';
const ANSWER_DEADLINE_MS = 75_000;
// Evidence lines kept for the retry. Measured on the same payload: the full
// 87 rows and a 30-row slice both answer, the slice faster.
const RETRY_EVIDENCE_LINES = 30;

/**
 * Shorten the gathered-evidence message for a retry, leaving every other
 * message untouched. The answer stays grounded in the same evidence, just
 * less of it.
 */
const trimEvidence = <T extends { role: string; content: string }>(
  messages: T[],
): T[] =>
  messages.map((message) => {
    if (!message.content.startsWith(EVIDENCE_PREFIX)) {
      return message;
    }
    const lines = message.content.split('\n');
    return lines.length <= RETRY_EVIDENCE_LINES
      ? message
      : {
          ...message,
          content: `${lines.slice(0, RETRY_EVIDENCE_LINES).join('\n')}\n(evidence trimmed for a retry)`,
        };
  });
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
  `string,"category":one of ${PROMPT_CATEGORIES.join('|')}}]} with 3 to 10 ` +
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
        // Same reasoning-budget hazard as the answer phase, and a cap that
        // binds here loses the panels and links silently rather than loudly.
        // The json_schema is what bounds this output, not a token ceiling.
        model: PLANNING_MODEL,
        maxTokens: null,
        responseFormat: metaResponseFormat(withTitle),
      },
    );
    return parseJson(raw, metaSchema);
  } catch {
    return null;
  }
};

export type StreamEvent =
  | { type: 'step'; label: string; detail?: string }
  | { type: 'delta'; text: string }
  | {
      type: 'done';
      chatId: number;
      title: string;
      messages: unknown[];
    }
  | { type: 'error'; message: string };

export type Emit = (event: StreamEvent) => Promise<void>;

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

// Run one grounded exchange, streaming honest progress: real pipeline stages
// with real counts, prose deltas as the model writes them, and structured
// metadata extracted by a separate call so it can never leak into the prose.
export const runExchange = async (
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
      const tool = offeredTool(tools, call.name);
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
            content: `${EVIDENCE_PREFIX}\n${evidence.join('\n\n')}`,
          },
        ]),
    ...conversation,
  ];
  // What the answer is actually built from, in the reader's terms. The model
  // then goes quiet for 30 to 46 seconds on a large payload, so this line has
  // to carry the weight of that wait rather than say nothing.
  await step(
    'reading the evidence',
    evidence.length === 0
      ? 'the workspace snapshot only'
      : `the snapshot and ${evidence.length} ${
          evidence.length === 1 ? 'lookup' : 'lookups'
        }`,
  );

  let prose = '';
  // One step when the reasoning pass starts, not one per chunk: the point is
  // to replace a frozen line with a true statement about what is happening.
  const reasoning = { announced: false };
  const onDelta = async (delta: string) => {
    if (!delta) {
      return;
    }
    if (prose.length === 0) {
      await step('writing the answer', 'grounded to the gathered evidence');
    }
    prose += delta;
    await emit({ type: 'delta', text: delta });
  };
  const onReasoning = async () => {
    if (!reasoning.announced) {
      reasoning.announced = true;
      await step('working through the evidence', 'before writing anything');
    }
  };
  const answerStartedAt = Date.now();
  const first = await runChatStream(
    env,
    messages,
    { maxTokens: ANSWER_TOKEN_CEILING, deadlineMs: ANSWER_DEADLINE_MS },
    onDelta,
    onReasoning,
  );
  console.log('chat answer', {
    ms: Date.now() - answerStartedAt,
    chars: prose.length,
    timedOut: first.timedOut,
  });
  // A draw that reasons past the deadline without writing anything is retried
  // once on a trimmed payload: fewer evidence lines measurably shortens the
  // reasoning pass, and a second attempt still lands far inside the object's
  // alarm. A partial answer is kept as it is rather than redrawn.
  if (first.timedOut && prose.length === 0) {
    await step('the first draft stalled', 'retrying on a tighter brief');
    const retryStartedAt = Date.now();
    const retry = await runChatStream(
      env,
      trimEvidence(messages),
      { maxTokens: ANSWER_TOKEN_CEILING, deadlineMs: ANSWER_DEADLINE_MS },
      onDelta,
      onReasoning,
    );
    console.log('chat answer retry', {
      ms: Date.now() - retryStartedAt,
      chars: prose.length,
      timedOut: retry.timedOut,
    });
  }

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

export const messageShape = {
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

/**
 * The question lands in D1 before the model runs. It used to be written with
 * the finished exchange, so a slow or failed run left the chat completely
 * empty: the user's own question was lost, navigating away lost the thread,
 * and a timeout was indistinguishable from a chat that never existed.
 */
export const storeQuestion = async (
  db: Db,
  chatId: number,
  question: string,
  receivedAt: number,
) => {
  const inserted = (
    await db
      .insert(chatMessages)
      .values({
        chatId,
        role: 'user',
        content: question,
        createdAt: receivedAt,
      })
      .returning(messageShape)
  )[0];
  await db
    .update(chats)
    .set({ updatedAt: receivedAt })
    .where(eq(chats.id, chatId));
  return inserted;
};

/**
 * Inserts the answer and returns the question with it. The `done` event has
 * always carried both rows, and the client replaces the thread with them, so
 * returning the answer alone would drop the question the user just sent.
 */
export const storeAnswer = async (
  db: Db,
  chatId: number,
  exchange: Exchange,
) => {
  await db.insert(chatMessages).values({
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
  });
  await db
    .update(chats)
    .set({ updatedAt: Date.now() })
    .where(eq(chats.id, chatId));
  return (
    await db
      .select(messageShape)
      .from(chatMessages)
      .where(eq(chatMessages.chatId, chatId))
      .orderBy(desc(chatMessages.id))
      .limit(2)
  ).reverse();
};

/**
 * A failed or timed-out exchange still owes the reader an answer row. Without
 * one the thread ends on the question and the UI cannot tell "still running"
 * from "died", which is exactly what a wedged exchange looked like in prod.
 */
export const storeFailure = async (
  db: Db,
  chatId: number,
  message: string,
  steps: ChatStep[],
  durationMs: number,
) => {
  const inserted = await db
    .insert(chatMessages)
    .values({
      chatId,
      role: 'assistant',
      content: message,
      panels: [],
      links: [],
      steps,
      durationMs,
      createdAt: Date.now(),
    })
    .returning(messageShape);
  await db
    .update(chats)
    .set({ updatedAt: Date.now() })
    .where(eq(chats.id, chatId));
  return inserted;
};
