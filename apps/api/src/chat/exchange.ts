// The grounded exchange engine, driven by the ChatExchange durable object:
// the planning loop, the answer phase, and the D1 persistence of the finished
// rows. The DO owns the live transport; this file owns what it streams.
// Deliberately free of durable-object types so the engine stays portable.
import type { ChatEvidenceRecord, ChatScope } from '@refd/core/chat';
import { CHAT_EXCHANGE_TIMEOUT_MS } from '@refd/core/chat';
import { normalizeDashes } from '@refd/core/dashes';
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
  EXPIRED,
  llmText,
  PLANNING_MODEL,
  PROMPT_CATEGORIES,
  parseJson,
  raceDeadline,
  runChat,
  runChatStream,
  runChatWithTools,
} from '../lib/llm';
import { resolveChatScope } from '../lib/range';
import { domainField } from '../lib/sanitize';
import { executeTool } from '../routes/agent-tools';
import { buildDigest, DIGEST_PANELS, type DigestPanel } from '../routes/digest';
import {
  type AgentTool,
  applyToolScope,
  availableTools,
  effectiveToolScope,
  offeredTool,
  toolDefinition,
} from '../routes/tool-registry';
import {
  createEvidenceRegistry,
  evidenceSources,
  persistedEvidence,
  registerToolEvidence,
  resolveEvidencePanels,
  selectEvidenceIds,
  stripUnresolvedMarkers,
} from './evidence';

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
  evidenceIds: z
    .array(
      z
        .string()
        .regex(/^E\d+$/)
        .catch(''),
    )
    .catch([]),
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
        text: normalizeDashes(item.text).trim(),
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
  const name = normalizeDashes(p.name).trim();
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
  '- If the question asks why a metric changed, call get_changes first: it ' +
  'compares the most recent completed runs on the cells both answered. ' +
  'Explain the movements it lists; anything beyond them is a hypothesis.\n' +
  '- If the question needs information from the public web (other companies, ' +
  'reviews, trends, research for drafting), call search_web.\n' +
  '- For questions spanning many prompts, surfaces, or dates, prefer one ' +
  'query_results or aggregate call over repeated get_prompt_results calls.\n' +
  '- The user waits through every lookup: when the workspace data already ' +
  'covers the question, gather nothing and reply at once.\n' +
  '- Never repeat a call with identical arguments, and never re-run an ' +
  'aggregation you already have under a trivially different date window.\n' +
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
  'values are counts of classified mentions; derive shares before writing ' +
  'percentages.\n' +
  '- Write plain markdown that scans at a glance: lead with the direct ' +
  'answer in one short sentence, bold the verdict words and the numbers ' +
  'the answer turns on (like **no**, **0%**, **4 of 25**), and enumerate ' +
  'prompts or pages as a short bullet list rather than a packed sentence, ' +
  'quoting at most one prompt verbatim. No headings, no JSON in the prose; ' +
  'keep the whole answer tight. Do not recite whole tables; the app ' +
  'renders the supporting data panels alongside your answer.\n' +
  '- Web results in the evidence are numbered S1, S2, ...: cite one in prose ' +
  'like (S2) only if you actually used it. The other numbered items are tool ' +
  'results. Evidence records are E0, E1, ...: cite material workspace claims ' +
  'with the supporting marker like (E1). When there are no web results, use ' +
  'no S-markers. Evidence IDs from earlier answers are not valid here: cite ' +
  'only the records gathered for this answer, and refer to an earlier answer ' +
  'in words, never by its markers.\n' +
  '- Evidence marked partial is a truncated sample of a larger set. Qualify ' +
  'any claim that rests on it with what was actually sampled ("in the 12 ' +
  'most recent answers"), and never state it as complete ("only", "always", ' +
  '"never").\n' +
  '- Report ties as ties. Never rank surfaces or entities with a score the ' +
  'data does not define (blending mention and citation rates into one ' +
  'verdict); offer the separate defined metrics instead.\n' +
  '- "Cited" means the brand domain appears in the answer\'s source ' +
  "metadata. A link inside a stored answer's text is not a citation flag: " +
  'if an answer visibly links the brand while the flag says not cited, say ' +
  'both rather than reconciling them.\n' +
  '- Never write em dashes or en dashes; recast the sentence with a comma, ' +
  'colon, or parentheses instead.\n' +
  '- Never mention tools, traces, or metadata in the prose.';

// Model-written titles arrive with stray quotes and whitespace often enough
// to launder them; empty after cleaning = no title, caller keeps its fallback.
const cleanTitle = (raw: string): string | null => {
  const cleaned = normalizeDashes(raw)
    .replace(/\s+/g, ' ')
    .replace(/^["'“”\s]+|["'“”.\s]+$/g, '')
    .trim();
  return cleaned.length > 0 ? cleaned.slice(0, 60) : null;
};

export interface Exchange {
  status: 'completed' | 'partial';
  content: string;
  title: string | null;
  panels: DigestPanel[];
  panelData: Record<string, unknown> | null;
  links: ChatLink[];
  steps: ChatStep[];
  durationMs: number;
  proposal: ChatProposal | null;
  sources: ChatWebSource[];
  scope: ChatScope;
  evidence: ChatEvidenceRecord[];
  selectedEvidenceIds: string[];
}

// Weighted ceiling on gathering per exchange. A cheap D1 aggregate should not
// cost the same as an R2 read or a page fetch.
const TOOL_BUDGET = 30;
// Hard bound on planning round trips, so a misbehaving model cannot spin
// forever even if every call it makes is free.
const MAX_PLANNING_ROUNDS = 20;
// One tool execution must not outlive the gather budget's ability to react:
// the soft deadline only fires between rounds, so a hung tool (a Browser
// render, a stalled fetch) would otherwise wedge the loop until the 5-minute
// alarm with no steps and no evidence beyond E0.
const TOOL_DEADLINE_MS = 60_000;
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
// Wall-clock caps on the non-streamed model calls, measured from call entry.
// A stalled planning turn returns the unreadable turn (the loop degrades to
// answering with gathered evidence); a stalled metadata call returns null (no
// panels or links; the answer itself is kept either way). Before these, a
// hung call outlived its intended bound and the object's 5-minute alarm was
// the only ceiling, which is how live chats died at ~300s in the answer phase.
const PLANNING_TURN_DEADLINE_MS = 90_000;
const META_DEADLINE_MS = 60_000;
// Gathering must yield before the object's alarm: past this point the loop
// stops taking new planning turns and the answer phase runs on what was
// gathered, so the deadline lands on an answer rather than a traceback.
const SOFT_GATHER_DEADLINE_MS = 150_000;
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

const panelRequestSchema = z.object({
  evidenceId: z.string().regex(/^E\d+$/),
  key: z.string(),
});

// Panel selection races the prose after gathering has finished. Each request
// names its owning evidence record, so live panels and persisted panels share
// the same evidence boundary.
const panelsSchema = z.object({
  panels: z.array(panelRequestSchema.nullable().catch(null)).catch([]),
});

const panelsResponseFormat = {
  type: 'json_schema' as const,
  json_schema: {
    name: 'panels',
    schema: {
      type: 'object',
      properties: {
        panels: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              evidenceId: { type: 'string' },
              key: { type: 'string' },
            },
            required: ['evidenceId', 'key'],
            additionalProperties: false,
          },
        },
      },
      required: ['panels'],
      additionalProperties: false,
    },
  },
} as const;

const panelsPrompt = (evidenceCatalog: string): string =>
  'You pick the data panels to render beside a refd workspace answer. You are ' +
  'given the question and the evidence catalog the answer will use. Return ' +
  'ONLY the JSON object the response schema asks for: panels is up to 2 ' +
  'objects with an evidenceId and a panel key owned by that same evidence ' +
  `row. Valid keys are [${DIGEST_PANELS.join(', ')}]. Use [] if none apply. ` +
  `Never invent an ID or key.\nEvidence catalog:\n${evidenceCatalog}`;

const extractPanels = async (
  env: AppEnv,
  question: string,
  evidenceCatalog: string,
): Promise<z.infer<typeof panelRequestSchema>[]> => {
  try {
    const raw = await runChat(
      env,
      [
        { role: 'system' as const, content: panelsPrompt(evidenceCatalog) },
        {
          role: 'user' as const,
          content: `Question:\n${question}`,
        },
      ],
      {
        model: PLANNING_MODEL,
        maxTokens: null,
        responseFormat: panelsResponseFormat,
        deadlineMs: META_DEADLINE_MS,
      },
    );
    const parsed = parseJson(raw, panelsSchema);
    return (parsed?.panels ?? []).flatMap((panel) => (panel ? [panel] : []));
  } catch {
    return [];
  }
};

export type ParsedMeta = z.infer<typeof metaSchema>;

// Extraction brief for the metadata call. The json_schema bounds the shape;
// this bounds the values. metaSchema and the laundering below remain the
// security boundary. Panels are picked separately while the prose streams.
const metaPrompt = (withTitle: boolean, evidenceCatalog: string): string =>
  'You read a finished assistant answer and extract structured metadata for ' +
  'the app to render. Return ONLY the JSON object the response schema asks ' +
  'for, copying values from the answer and never inventing them.\n' +
  (withTitle
    ? '- title: a crisp name for this conversation, at most 6 plain words ' +
      'naming the topic, no quotes and no trailing punctuation.\n'
    : '') +
  '- evidenceIds: IDs from the evidence catalog that materially support the ' +
  'answer. Use only listed IDs; [] if none apply.\n' +
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
  `Evidence catalog:\n${evidenceCatalog}`;

const metaResponseFormat = (withTitle: boolean) => ({
  type: 'json_schema' as const,
  json_schema: {
    name: 'meta',
    schema: {
      type: 'object',
      properties: {
        ...(withTitle ? { title: { type: 'string' } } : {}),
        evidenceIds: { type: 'array', items: { type: 'string' } },
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
      },
      required: [
        ...(withTitle ? ['title'] : []),
        'evidenceIds',
        'links',
        'proposal',
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
  evidenceCatalog: string,
): Promise<ParsedMeta | null> => {
  try {
    const raw = await runChat(
      env,
      [
        {
          role: 'system' as const,
          content: metaPrompt(withTitle, evidenceCatalog),
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
        deadlineMs: META_DEADLINE_MS,
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
      type: 'meta';
      panels: string[];
      panelData: Record<string, unknown> | null;
    }
  | {
      type: 'done';
      chatId: number;
      title: string;
      messages: unknown[];
    }
  | { type: 'error'; message: string };

export type Emit = (event: StreamEvent) => Promise<void>;

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

export const citedSourceNumbers = (prose: string): number[] => [
  ...new Set(
    [...prose.matchAll(/\(S(\d+)\)/g)].flatMap((match) => {
      const value = Number.parseInt(match[1] ?? '', 10);
      return Number.isInteger(value) ? [value] : [];
    }),
  ),
];

// Run one grounded exchange, streaming honest progress: real pipeline stages
// with real counts, prose deltas as the model writes them, and structured
// metadata extracted by a separate call so it can never leak into the prose.
export const runExchange = async (
  env: AppEnv,
  db: Db,
  workspaceId: number,
  history: { role: 'user' | 'assistant'; content: string }[],
  question: string,
  opts: {
    withTitle?: boolean;
    acceptedAt?: number;
    inheritedScope?: ChatScope | null;
    inheritedFromMessageId?: number;
    onPhase?: (phase: 'gathering' | 'answering' | 'metadata') => Promise<void>;
    // Live copy of the evidence gathered so far. The durable object reads it
    // when the alarm (or a crash) kills the exchange, so a timed-out turn
    // still persists the receipt of the lookups that ran.
    evidenceSink?: { records: ChatEvidenceRecord[] };
  },
  emit: Emit,
): Promise<Exchange> => {
  const started = Date.now();
  const steps: ChatStep[] = [];
  const step = async (label: string, detail?: string) => {
    steps.push(detail === undefined ? { label } : { label, detail });
    await emit({ type: 'step', label, detail });
  };

  const scope = resolveChatScope(
    question,
    opts.acceptedAt ?? started,
    opts.inheritedScope,
    opts.inheritedFromMessageId,
  );
  await opts.onPhase?.('gathering');
  const digest = await buildDigest(db, workspaceId, scope);
  if (!digest) {
    const content =
      'This workspace is not set up yet, so there is no data to talk to. Finish onboarding first.';
    await emit({ type: 'delta', text: content });
    return {
      status: 'completed',
      content,
      title: null,
      panels: [],
      panelData: null,
      links: [],
      steps,
      durationMs: Date.now() - started,
      proposal: null,
      sources: [],
      scope,
      evidence: [],
      selectedEvidenceIds: [],
    };
  }
  const registry = createEvidenceRegistry(digest);
  const sinkEvidence = () => {
    if (opts.evidenceSink) {
      opts.evidenceSink.records = persistedEvidence(registry);
    }
  };
  sinkEvidence();

  // The panel emit waits for the first streamed token: the text always leads.
  // The deferred settles after the answer phase too, so a no-prose exchange
  // still delivers its scope and panels instead of wedging the final join.
  let resolveProseStarted: () => void = () => {};
  const proseStarted = new Promise<void>((resolve) => {
    resolveProseStarted = resolve;
  });
  const sections = digest.sections as {
    surfaces: unknown[];
    competitors: unknown[];
    runs: unknown[];
    prompts: { tracked: number };
    sources: { topCited: unknown[]; gap: unknown[] };
  };
  const count = (n: number, word: string): string => {
    const plural =
      word.endsWith('y') && !/[aeiou]y$/.test(word)
        ? `${word.slice(0, -1)}ies`
        : `${word}s`;
    return `${n} ${n === 1 ? word : plural}`;
  };
  // sections.runs is the trend pair (two most recent runs), not the window's
  // run count; say so when the window holds more.
  const runPart =
    digest.runsInWindow === sections.runs.length
      ? count(sections.runs.length, 'run')
      : `${count(sections.runs.length, 'recent run')} of ${digest.runsInWindow} in window`;
  await step(
    'read the workspace snapshot',
    `${digest.rangeLabel} · ${count(sections.surfaces.length, 'surface')} · ` +
      `${count(sections.competitors.length, 'entity')} · ${count(sections.prompts.tracked, 'prompt')} · ` +
      `${runPart} · ${count(sections.sources.topCited.length + sections.sources.gap.length, 'source domain')}`,
  );
  await opts.onPhase?.('answering');

  const dataMessage = {
    role: 'system' as const,
    content:
      `Evidence E0. Workspace data for ${digest.brand}. ` +
      `Scope: ${JSON.stringify(digest.scope)}\n${JSON.stringify(digest.sections)}`,
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
  // Sources already registered this exchange, as URL to its 1-based S-number.
  // Tools filter against it before numbering their own results and state the
  // number in their output, so what the model cites always matches what is
  // actually registered here.
  const knownSourceUrls = new Map<string, number>();
  const seenCalls = new Set<string>();
  // Date-scoped reads with the same filters but different windows are near
  // duplicates; after two of them the third is a loop, not a comparison.
  const nearDuplicateCounts = new Map<string, number>();
  const toolMessages: unknown[] = [];
  let spent = 0;
  let rounds = 0;
  const toolsUsed = () =>
    `${evidence.length} ${evidence.length === 1 ? 'tool' : 'tools'} used`;

  for (;;) {
    if (Date.now() - started >= SOFT_GATHER_DEADLINE_MS) {
      await step(
        'approaching the time limit',
        'answering from what was gathered',
      );
      break;
    }
    const turn = await runChatWithTools(
      env,
      [
        { role: 'system' as const, content: systemPlanning },
        dataMessage,
        ...conversation,
        ...toolMessages,
      ],
      toolDefs,
      // No token ceiling: a cap only ever truncates the reasoning the turn
      // needs. The wall-clock deadline is what bounds a stalled turn.
      {
        model: PLANNING_MODEL,
        maxTokens: null,
        deadlineMs: PLANNING_TURN_DEADLINE_MS,
      },
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
      const scoped = applyToolScope(tool, parsed.args, digest.scope);
      if (!scoped.ok) {
        await step(`${tool.name} skipped`, 'outside the question scope');
        toolMessages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: `Tool ${tool.name} was not run: ${scoped.error}.`,
        });
        continue;
      }
      const callKey = `${tool.name}:${JSON.stringify(scoped.args)}`;
      if (seenCalls.has(callKey)) {
        await step('skipped a repeated lookup', tool.name);
        toolMessages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: `You already ran ${tool.name} with these exact arguments. Choose a different call, or stop calling tools when you have enough.`,
        });
        continue;
      }
      const semanticKey = `${tool.name}:${JSON.stringify(
        Object.fromEntries(
          Object.entries((scoped.args ?? {}) as Record<string, unknown>)
            .filter(
              ([key]) => key !== 'from' && key !== 'to' && key !== 'limit',
            )
            .sort(([a], [b]) => a.localeCompare(b)),
        ),
      )}`;
      const nearDuplicates = nearDuplicateCounts.get(semanticKey) ?? 0;
      if (nearDuplicates >= 2) {
        await step('skipped a near-duplicate lookup', tool.name);
        toolMessages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: `You have already run ${tool.name} with these filters over two different date windows. Use the evidence you gathered, or change the filters materially; repeating this shape wastes the time limit.`,
        });
        continue;
      }
      // Reserve the cost before executing: checking only after a whole batch
      // let one round spend past the cap (the live run that hit 34 of 30).
      // The call is not marked seen, because it never ran.
      if (spent + tool.cost > TOOL_BUDGET) {
        await step('skipped, tool budget reached', tool.name);
        toolMessages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: `Tool ${tool.name} was not run: the tool budget for this exchange is used up. Stop calling tools and answer from the evidence already gathered.`,
        });
        continue;
      }
      seenCalls.add(callKey);
      nearDuplicateCounts.set(semanticKey, nearDuplicates + 1);
      const toolScope = effectiveToolScope(scoped.args, digest.scope);
      const settled = await raceDeadline(
        executeTool(
          env,
          workspaceId,
          tool.name,
          scoped.args,
          allSources.length,
          knownSourceUrls,
          toolScope,
        ),
        TOOL_DEADLINE_MS,
      );
      if (settled === EXPIRED) {
        await step(`${tool.name} timed out`, 'no result within the time limit');
        toolMessages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: `Tool ${tool.name} did not finish within the time limit and produced no result. Continue with other tools, or answer from the evidence already gathered.`,
        });
        continue;
      }
      const outcome = settled;
      if (outcome.sources) {
        for (const source of outcome.sources) {
          if (!knownSourceUrls.has(source.url)) {
            allSources.push(source);
            knownSourceUrls.set(source.url, allSources.length);
          }
        }
      }
      await step(outcome.label, outcome.detail);
      const record = registerToolEvidence(
        registry,
        tool.name,
        scoped.args,
        outcome.result,
        toolScope,
        outcome.evidence,
      );
      sinkEvidence();
      toolMessages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: `Evidence ${record.id}:\n${outcome.result}`,
      });
      evidence.push(
        `${record.id}. ${tool.name}(${JSON.stringify(scoped.args)})\n${outcome.result}`,
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

  const evidenceCatalog = registry.records
    .map(
      (record) =>
        `${record.id}: ${record.tool ?? 'workspace snapshot'}; status=${record.status}; scope=${record.scope.label}; ` +
        `panels=${Object.keys(record.panels ?? {}).join(',') || 'none'}; ` +
        `result=${record.result.slice(0, 500)}`,
    )
    .join('\n');

  // The evidence-bound picker runs alongside the answer, but its emit waits
  // for prose to start. Reconnects replay the same sequenced meta event.
  const panelsPromise = extractPanels(env, question, evidenceCatalog).then(
    async (requests) => {
      const selectedEvidenceIds = selectEvidenceIds(
        '',
        requests.map((request) => request.evidenceId),
        registry,
      );
      const resolved = resolveEvidencePanels(
        registry,
        selectedEvidenceIds,
        requests,
        digest.scope,
      );
      const panelData = resolved.panelData ?? {
        _window: digest.rangeLabel,
        _scope: digest.scope,
      };
      await proseStarted;
      await step(
        resolved.panels.length > 0
          ? 'selected evidence panels'
          : 'no evidence panels apply',
        resolved.panels.length > 0 ? resolved.panels.join(', ') : undefined,
      );
      await emit({ type: 'meta', panels: resolved.panels, panelData });
      return { ...resolved, panelData, selectedEvidenceIds };
    },
  );
  let prose = '';
  // One step when the reasoning pass starts, not one per chunk: the point is
  // to replace a frozen line with a true statement about what is happening.
  const reasoning = { announced: false };
  const onDelta = async (delta: string) => {
    if (!delta) {
      return;
    }
    // Dashes are single UTF-16 code units, so one can never straddle two
    // deltas; the final pass below only mops up cross-delta space artifacts.
    const clean = normalizeDashes(delta);
    if (prose.length === 0) {
      await step('writing the answer', 'grounded to the gathered evidence');
      // The panel pick was emitted against this gate: the text leads.
      resolveProseStarted();
    }
    prose += clean;
    await emit({ type: 'delta', text: clean });
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
  let answerTimedOut = first.timedOut;
  console.log('chat answer', {
    ms: Date.now() - answerStartedAt,
    chars: prose.length,
    timedOut: first.timedOut,
  });
  // A draw that reasons past the deadline without writing anything is retried
  // once on a trimmed payload: fewer evidence lines measurably shortens the
  // reasoning pass, and a second attempt still lands far inside the object's
  // alarm — but only when a full retry plus metadata still fits before it.
  const hardEnd = (opts.acceptedAt ?? started) + CHAT_EXCHANGE_TIMEOUT_MS;
  const retryFits =
    Date.now() + ANSWER_DEADLINE_MS + META_DEADLINE_MS + 20_000 < hardEnd;
  if (first.timedOut && prose.length === 0 && retryFits) {
    await step('the first draft stalled', 'retrying on a tighter brief');
    const retryStartedAt = Date.now();
    const retry = await runChatStream(
      env,
      trimEvidence(messages),
      { maxTokens: ANSWER_TOKEN_CEILING, deadlineMs: ANSWER_DEADLINE_MS },
      onDelta,
      onReasoning,
    );
    answerTimedOut = retry.timedOut;
    console.log('chat answer retry', {
      ms: Date.now() - retryStartedAt,
      chars: prose.length,
      timedOut: retry.timedOut,
    });
  }

  // Both the metadata call and the stored answer read this cleaned prose, so
  // labels and titles copied from it inherit the dash-free form.
  prose = normalizeDashes(prose);
  // Markers copied from an earlier answer's numbering would persist a receipt
  // this exchange cannot back; unresolvable ones leave before anything reads
  // the prose.
  prose = stripUnresolvedMarkers(prose, registry);
  // Settle the panel gate here too: an exchange that produced no prose at all
  // (the fallback answer) still delivers its panels instead of hanging.
  resolveProseStarted();

  await opts.onPhase?.('metadata');
  // The join keeps the tail a max, not a sum: whichever call is slower sets
  // the wait after the prose, and both usually finish during it.
  const [pick, meta] = await Promise.all([
    panelsPromise,
    extractMeta(env, question, prose, opts.withTitle === true, evidenceCatalog),
  ]);
  const selectedEvidenceIds = selectEvidenceIds(
    prose,
    [...(meta?.evidenceIds ?? []), ...pick.selectedEvidenceIds],
    registry,
  );
  const sources = evidenceSources(prose, registry).slice(0, 6);
  const links = (meta?.links ?? [])
    .filter((l): l is NonNullable<typeof l> => l !== null && validLink(l.to))
    .map((l) => ({ ...l, label: normalizeDashes(l.label) }))
    .slice(0, 2);
  const durationMs = Date.now() - started;
  await step(
    'answer ready',
    `${seconds(durationMs)}${sources.length > 0 ? ` · ${sources.length} web sources cited` : ''}`,
  );

  const content = prose.trim().slice(0, 4000) || ANSWER_FALLBACK;
  return {
    status: answerTimedOut ? 'partial' : 'completed',
    content,
    title: opts.withTitle === true ? cleanTitle(meta?.title ?? '') : null,
    panels: pick.panels,
    panelData: pick.panelData,
    links,
    steps,
    durationMs,
    proposal: toProposal(meta),
    sources,
    scope: digest.scope,
    evidence: persistedEvidence(registry),
    selectedEvidenceIds,
  };
};

export const messageShape = {
  id: chatMessages.id,
  exchangeId: chatMessages.exchangeId,
  role: chatMessages.role,
  content: chatMessages.content,
  panels: chatMessages.panels,
  panelData: chatMessages.panelData,
  links: chatMessages.links,
  steps: chatMessages.steps,
  durationMs: chatMessages.durationMs,
  proposal: chatMessages.proposal,
  sources: chatMessages.sources,
  evidence: chatMessages.evidence,
  selectedEvidenceIds: chatMessages.selectedEvidenceIds,
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
  exchangeId?: string,
) => {
  const inserted = (
    await db
      .insert(chatMessages)
      .values({
        exchangeId,
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
 * A failed or timed-out exchange still owes the reader an answer row. Without
 * one the thread ends on the question and the UI cannot tell "still running"
 * from "died", which is exactly what a wedged exchange looked like in prod.
 */
export const storeFailure = async (
  db: Db,
  chatId: number,
  exchangeId: string | null,
  message: string,
  steps: ChatStep[],
  durationMs: number,
) => {
  const values = {
    exchangeId,
    chatId,
    role: 'assistant' as const,
    content: message,
    panels: [],
    links: [],
    steps,
    durationMs,
    createdAt: Date.now(),
  };
  if (exchangeId === null) {
    await db.insert(chatMessages).values(values);
  } else {
    await db
      .insert(chatMessages)
      .values(values)
      .onConflictDoNothing({
        target: [chatMessages.exchangeId, chatMessages.role],
      });
  }
  await db
    .update(chats)
    .set({ updatedAt: Date.now() })
    .where(eq(chats.id, chatId));
  return exchangeId === null
    ? db
        .select(messageShape)
        .from(chatMessages)
        .where(eq(chatMessages.chatId, chatId))
        .orderBy(desc(chatMessages.id))
        .limit(1)
    : db
        .select(messageShape)
        .from(chatMessages)
        .where(eq(chatMessages.exchangeId, exchangeId))
        .orderBy(chatMessages.id);
};
