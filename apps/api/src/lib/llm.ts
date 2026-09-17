import { z } from 'zod';
import type { AppEnv } from '../env';
import { validate } from './validate';

export const LLM_MODEL = '@cf/zai-org/glm-5.3';

// The planning loop only has to pick a tool, and it runs many times per
// exchange. Flash is ~9x cheaper at the same context window.
export const PLANNING_MODEL = '@cf/zai-org/glm-5.3-flash';

// Sentiment is a bounded structured-output task, and a prod replay showed
// flash agrees with glm-5.3's labels within glm-5.3's own noise band at a
// quarter of the output tokens. SENTIMENT_MODEL can pin either direction.
export const SENTIMENT_DEFAULT_MODEL = '@cf/zai-org/glm-5.3-flash';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// A ceiling is a circuit breaker, not a length control: the budget is shared
// with the model's private reasoning pass, so a cap that binds truncates the
// answer rather than shortening it, and bills the full budget for the wreckage.
// What actually bounds output is the prompt. `maxTokens: null` therefore means
// "no ceiling" and omits the field entirely; omitting the option keeps the
// legacy 1500 for callers that never chose a number. glm-5.3 renamed the
// ceiling parameter; the old name is deprecated on it.
export const tokenInputs = (maxTokens: number | null | undefined) =>
  maxTokens === null ? {} : { max_completion_tokens: maxTokens ?? 1500 };

// Deadline expiry marker for the races below. The losing promise keeps
// running in the background, so its rejection is handled here rather than
// surfacing as an unhandled rejection after the deadline already won.
export const EXPIRED = Symbol('deadline-expired');

// Race a promise against a wall-clock budget. Expiry resolves to EXPIRED
// rather than rejecting: the caller decides what a timeout means (a partial
// answer, an unreadable turn, an empty string). `null` runs unbounded, so
// callers that never chose a deadline behave exactly as before.
export const raceDeadline = <T>(
  promise: Promise<T>,
  ms: number | null,
): Promise<T | typeof EXPIRED> => {
  if (ms === null) {
    return promise;
  }
  return new Promise<T | typeof EXPIRED>((resolve, reject) => {
    const timer = setTimeout(() => resolve(EXPIRED), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
};

// glm models aren't in wrangler's generated Ai model union, so the binding is
// called through a loose shape. Returns the raw text response (or '').
// `responseFormat` passes a response_format through for structured-output calls.
export const runChat = async (
  env: AppEnv,
  messages: ChatMessage[],
  opts: {
    model?: string;
    maxTokens?: number | null;
    responseFormat?: unknown;
    deadlineMs?: number;
  } = {},
): Promise<string> => {
  const ai = env.AI as unknown as {
    run: (
      model: string,
      inputs: Record<string, unknown>,
    ) => Promise<{
      response?: unknown;
      choices?: { message?: { content?: unknown } }[];
    }>;
  };
  const res = await raceDeadline(
    ai.run(opts.model ?? LLM_MODEL, {
      messages,
      ...tokenInputs(opts.maxTokens),
      ...(opts.responseFormat !== undefined
        ? { response_format: opts.responseFormat }
        : {}),
    }),
    opts.deadlineMs ?? null,
  );
  if (res === EXPIRED) {
    console.warn('chat: model call timed out', opts.model ?? LLM_MODEL);
    return '';
  }
  // glm models answer OpenAI-style (choices[].message.content); other Workers
  // AI chat models use { response }. Accept both.
  const content = res?.choices?.[0]?.message?.content;
  if (typeof content === 'string' && content) {
    return content;
  }
  const out = res?.response;
  return typeof out === 'string' ? out : out == null ? '' : JSON.stringify(out);
};

export interface ToolCall {
  id: string;
  name: string;
  // Unparsed: arguments are model output and stay a string until the caller
  // JSON-parses and validates them against the tool's schema.
  rawArguments: string;
}

export interface ChatTurn {
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: string;
  // The tool_calls array exactly as received, so the caller can echo the
  // assistant turn back verbatim (the protocol requires it).
  rawToolCalls: unknown;
}

// Lenient envelope: one unreadable field must degrade to a default, never
// discard the response. The per-call view fills defaults for malformed
// entries rather than dropping them, so every echoed call gets a matching
// tool message. The model's private reasoning stream is deliberately not
// part of this schema and must never be forwarded to a user.
const toolCallView = z.object({
  id: z.string().catch(''),
  function: z
    .object({ name: z.string().catch(''), arguments: z.string().catch('') })
    .catch({ name: '', arguments: '' }),
});
const emptyToolCall = { id: '', function: { name: '', arguments: '' } };

const chatTurnShape = z.object({
  choices: z
    .array(
      z
        .object({
          finish_reason: z.string().catch('stop'),
          message: z
            .object({
              content: z.string().nullish().catch(null),
              tool_calls: z.array(z.unknown()).nullish().catch([]),
            })
            .nullish()
            .catch(null),
        })
        .nullish()
        .catch(null),
    )
    .nullish()
    .catch([]),
  // Reported per call; tracked while transcripts grow to see whether
  // context caching is actually engaging.
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
      prompt_tokens_details: z
        .object({ cached_tokens: z.number().optional() })
        .optional(),
    })
    .optional(),
});

// Non-streaming tool-calling turn (glm-5.3 native function calling, OpenAI
// shape). A planning turn needs the complete tool_calls array before it can
// act, so streaming buys nothing here. On any unreadable response the caller
// gets a no-tool-calls stop turn and degrades to answering.
export const runChatWithTools = async (
  env: AppEnv,
  messages: unknown[],
  tools: unknown[],
  opts: {
    model?: string;
    maxTokens?: number | null;
    deadlineMs?: number;
  } = {},
): Promise<ChatTurn> => {
  const unreadable: ChatTurn = {
    content: null,
    toolCalls: [],
    finishReason: 'stop',
    rawToolCalls: [],
  };
  const ai = env.AI as unknown as {
    run: (model: string, inputs: Record<string, unknown>) => Promise<unknown>;
  };
  let res: unknown;
  try {
    res = await raceDeadline(
      ai.run(opts.model ?? LLM_MODEL, {
        messages,
        tools,
        ...tokenInputs(opts.maxTokens),
      }),
      opts.deadlineMs ?? null,
    );
  } catch (error) {
    console.error('chat tools: model call failed', error);
    return unreadable;
  }
  if (res === EXPIRED) {
    console.error('chat tools: model call timed out');
    return unreadable;
  }
  const parsed = validate(res, chatTurnShape);
  const choice = parsed?.choices?.[0];
  if (parsed?.usage) {
    console.log(
      'chat tools usage',
      JSON.stringify({
        model: opts.model ?? LLM_MODEL,
        promptTokens: parsed.usage.prompt_tokens ?? null,
        completionTokens: parsed.usage.completion_tokens ?? null,
        cachedTokens: parsed.usage.prompt_tokens_details?.cached_tokens ?? null,
      }),
    );
  }
  if (!choice) {
    return unreadable;
  }
  const rawToolCalls = choice.message?.tool_calls ?? [];
  const toolCalls = rawToolCalls.map((raw) => {
    const view = validate(raw, toolCallView) ?? emptyToolCall;
    return {
      id: view.id,
      name: view.function.name,
      rawArguments: view.function.arguments,
    };
  });
  return {
    content: choice.message?.content ?? null,
    toolCalls,
    finishReason: choice.finish_reason,
    rawToolCalls,
  };
};

// Streaming variant: Workers AI returns SSE bytes; each `data:` line carries
// either `{response}` (native models) or OpenAI-style `{choices[].delta}`.
// Both shapes are accepted per chunk. Resolves with the full text after the
// stream ends; onDelta fires per text fragment as it arrives.
export const runChatStream = async (
  env: AppEnv,
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  opts: {
    model?: string;
    maxTokens?: number | null;
    // Wall-clock bound on how long this stream may be read. Reaching it stops
    // the read and returns whatever arrived; it does not shorten the answer
    // the model was asked for.
    deadlineMs?: number;
  } = {},
  onDelta?: (text: string) => void | Promise<void>,
  // Fires with the length of each reasoning chunk, never its text.
  onReasoning?: (chars: number) => void | Promise<void>,
): Promise<{ text: string; timedOut: boolean }> => {
  const ai = env.AI as unknown as {
    run: (
      model: string,
      inputs: Record<string, unknown>,
    ) => Promise<ReadableStream<Uint8Array>>;
  };
  // The budget is measured from function entry, so the startup await and every
  // read share it: a stalled startup or a silent read can no longer outlive
  // the deadline and leave the exchange's alarm as the only bound.
  const deadlineAt =
    opts.deadlineMs !== undefined ? Date.now() + opts.deadlineMs : null;
  const remainingMs = () =>
    deadlineAt === null ? null : Math.max(0, deadlineAt - Date.now());
  // The model can enter a reasoning loop that emits nothing for minutes, and a
  // hung provider can stall before the first byte. Both are abandoned at the
  // deadline so one bad draw cannot consume the whole exchange; whatever prose
  // arrived is kept.
  const opened = await raceDeadline(
    ai.run(opts.model ?? LLM_MODEL, {
      messages,
      ...tokenInputs(opts.maxTokens),
      stream: true,
    }),
    remainingMs(),
  );
  if (opened === EXPIRED) {
    return { text: '', timedOut: true };
  }
  const stream = opened;
  const decoder = new TextDecoder();
  let buffered = '';
  let full = '';
  const reader = stream.getReader();
  let timedOut = false;
  for (;;) {
    const next = await raceDeadline(reader.read(), remainingMs());
    if (next === EXPIRED) {
      timedOut = true;
      await reader.cancel().catch(() => {});
      break;
    }
    const { done, value } = next;
    if (done) {
      break;
    }
    buffered += decoder.decode(value, { stream: true });
    // SSE frames are newline-delimited; a frame may span reads.
    const lines = buffered.split('\n');
    buffered = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) {
        continue;
      }
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') {
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch {
        continue;
      }
      const record = parsed as {
        response?: unknown;
        choices?: {
          delta?: { content?: unknown; reasoning_content?: unknown };
        }[];
      };
      // glm-5.3 streams a reasoning pass before its first content token, and
      // on a large evidence payload that runs 30 to 46 seconds. The text is
      // the model's private working and is never forwarded, but its arrival
      // is proof the turn is alive, which is the only honest progress signal
      // available during that silence.
      const reasoning = record.choices?.[0]?.delta?.reasoning_content;
      if (typeof reasoning === 'string' && reasoning.length > 0) {
        await onReasoning?.(reasoning.length);
      }
      const delta =
        typeof record.response === 'string'
          ? record.response
          : typeof record.choices?.[0]?.delta?.content === 'string'
            ? record.choices[0].delta.content
            : '';
      if (delta) {
        full += delta;
        await onDelta?.(delta);
      }
    }
  }
  return { text: full, timedOut };
};

// How many `{`-rooted candidates to try before giving up. Real output carries
// one object plus at most a little surrounding noise; the bound stops a wall of
// braces from turning a parse into a scan of the whole response.
const MAX_JSON_CANDIDATES = 6;

/**
 * Every balanced `{...}` span in the text, outermost first. Slicing from the
 * first `{` to the *last* `}` (the previous approach) breaks on the two shapes
 * models actually produce: two objects in a row, and one object followed by a
 * sentence containing a brace. Both yielded an unparseable span and looked
 * identical to "the model said nothing".
 */
const objectCandidates = (raw: string): string[] => {
  const found: string[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] !== '{') {
      continue;
    }
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let j = i; j < raw.length; j += 1) {
      const ch = raw[j];
      if (escaped) {
        escaped = false;
      } else if (inString) {
        if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
      } else if (ch === '"') {
        inString = true;
      } else if (ch === '{') {
        depth += 1;
      } else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          found.push(raw.slice(i, j + 1));
          i = j;
          break;
        }
      }
    }
    if (found.length >= MAX_JSON_CANDIDATES) {
      break;
    }
  }
  return found;
};

// Locate a JSON object in a model response (models wrap JSON in prose or code
// fences often enough that a strict whole-string parse is too brittle) and
// validate it against a Zod schema. Candidates are tried in order and the first
// that both parses and validates wins, so a stray brace earlier in the prose no
// longer discards the real object. Returns null if nothing validates — every
// caller degrades gracefully.
export const parseJson = <T>(raw: string, schema: z.ZodType<T>): T | null => {
  for (const candidate of objectCandidates(raw)) {
    let value: unknown;
    try {
      value = JSON.parse(candidate);
    } catch {
      continue;
    }
    const validated = validate(value, schema);
    if (validated !== null) {
      return validated;
    }
  }
  return null;
};

// LLM output is untrusted: cap length by truncating (transform) rather than
// rejecting, so a slightly-too-long field never discards an otherwise good result.
export const llmText = (max: number) =>
  z.string().transform((s) => s.trim().slice(0, max));

const brandDescriptionSchema = z.object({
  // description is required + non-empty (a blank draft is a failure → manual entry);
  // the secondary fields degrade to '' rather than discarding an otherwise good draft.
  description: llmText(800).pipe(z.string().min(1)),
  summary: llmText(1500).catch(''),
  targetMarket: llmText(200).catch(''),
});

export type BrandDescription = z.infer<typeof brandDescriptionSchema>;

// Draft an editable brand profile from the fetched site text. Null on any failure
// (LLM error, unparseable output, missing/empty description) so the caller falls
// back to manual entry.
export const describeBrand = async (
  env: AppEnv,
  input: { name: string; domain: string; siteText: string },
): Promise<BrandDescription | null> => {
  const system =
    'You write concise, factual brand profiles for a marketing analytics tool. ' +
    'Return ONLY a JSON object of the form ' +
    '{"description": string, "summary": string, "targetMarket": string}. ' +
    '"description" is one or two plain sentences a buyer would recognise, no marketing fluff. ' +
    '"summary" is 2-4 sentences of internal notes on what the brand does, its category, and how it positions. ' +
    '"targetMarket" is a short phrase naming who it is for. Do not invent facts not supported by the content.';
  const user = `Brand: ${input.name}\nDomain: ${input.domain}\n\nSite content:\n${input.siteText}`;

  try {
    const text = await runChat(env, [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]);
    return parseJson(text, brandDescriptionSchema);
  } catch {
    return null;
  }
};

export type Sentiment = 'positive' | 'neutral' | 'negative';

// A malformed item drops to null (that entity stays unclassified) instead of
// being coerced to a guessed value.
const sentimentItemSchema = z.object({
  entity: z.number().int(),
  sentiment: z.enum(['positive', 'neutral', 'negative']),
});
const sentimentsSchema = z.object({
  sentiments: z.array(sentimentItemSchema.nullable().catch(null)).catch([]),
});

// The response_format schema is the contract; this is the same schema as the
// runtime enforces, so the model cannot shape-drift its way past parseJson.
const sentimentResponseFormat = () => ({
  type: 'json_schema' as const,
  json_schema: {
    name: 'sentiment',
    schema: {
      type: 'object',
      properties: {
        sentiments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              entity: { type: 'integer' },
              sentiment: {
                type: 'string',
                enum: ['positive', 'neutral', 'negative'],
              },
            },
            required: ['entity', 'sentiment'],
            additionalProperties: false,
          },
        },
      },
      required: ['sentiments'],
      additionalProperties: false,
    },
  },
});

// Answers can be long (AI Mode especially); cap the prompt payload. Entities
// whose first mention lies beyond this window are invisible to the main call
// and get a second pass over the tail (see the consumer).
export const SENTIMENT_TEXT_MAX = 12000;
// Context re-included before a tail-window entity's first mention, so stance
// is judged with some surrounding text rather than a bare excerpt.
export const SENTIMENT_TAIL_CONTEXT = 2000;

// Classify how one AI answer portrays each mentioned entity, in a single
// call. Entities are referenced by number (the same trick as Exa competitor
// curation) so the model can never introduce one, and each entry may carry the
// matched span text (`matchedAs`) so an alias match grounds to the right
// referent. Partial output is fine: a missing or malformed entry leaves that
// entity unclassified (null), never guessed. Returns null when the model
// answered but produced no parseable JSON, which callers treat as transient
// and retry rather than acking nulls forever.
//
// Default classifier is glm-5.3-flash: replayed against 96 prod mentions it
// agreed with glm-5.3's own labels within glm-5.3's run-to-run noise band
// (89.4% vs its own 90.0%), classified more mentions (2 vs 6 unclassified),
// and emitted ~25% fewer completion tokens. SENTIMENT_MODEL overrides it.
export const classifySentiments = async (
  env: AppEnv,
  input: {
    answerText: string;
    entities: { id: number; name: string; matchedAs?: string }[];
  },
): Promise<Map<number, Sentiment> | null> => {
  const system =
    'You judge how an AI-generated answer portrays specific brands or products. ' +
    "For each numbered entity, classify the answer's stance toward it: " +
    '"positive" (recommended, praised, or presented favourably), ' +
    '"negative" (criticised, discouraged, unfavourably compared, or positioned as the lesser option). ' +
    'Comparative framings count as negative for the entity they diminish: "unlike X", "X lacks", "a replacement for X", ' +
    'or any contrast that presents X as the lesser choice. ' +
    '"neutral" (listed or described without clear valence). Judge each entity independently: ' +
    'listing an entity without valence is neutral even when other entities are favoured. ' +
    'An entity may appear in the answer under the alternate name shown in parentheses; ' +
    'treat those references as the same entity and judge them together. ' +
    'Return ONLY a JSON object {"sentiments":[{"entity":number,"sentiment":"positive"|"neutral"|"negative"}]} ' +
    'covering every numbered entity. Judge only the listed entities.';
  const list = input.entities
    .map(
      (e, i) =>
        `${i + 1}. ${e.name}${e.matchedAs ? ` (appears as "${e.matchedAs}")` : ''}`,
    )
    .join('\n');
  const user = `Entities:\n${list}\n\nAnswer:\n${input.answerText.slice(0, SENTIMENT_TEXT_MAX)}`;
  const text = await runChat(
    env,
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    {
      model: env.SENTIMENT_MODEL?.trim() || SENTIMENT_DEFAULT_MODEL,
      maxTokens: 2000,
      responseFormat: sentimentResponseFormat(),
    },
  );
  const parsed = parseJson(text, sentimentsSchema);
  if (!parsed) {
    console.warn('sentiment: unparseable model output');
    return null;
  }
  const verdicts = new Map<number, Sentiment>();
  for (const item of parsed.sentiments) {
    const entity = item ? input.entities[item.entity - 1] : undefined;
    if (item && entity) {
      verdicts.set(entity.id, item.sentiment);
    }
  }
  return verdicts;
};

// Buyer-journey categories, 5 prompts each. Keep in sync with the client.
export const PROMPT_CATEGORIES = [
  'Discovery',
  'Evaluation',
  'Comparison',
  'Decision',
  'Authority',
] as const;

const CATEGORY_HINTS: Record<(typeof PROMPT_CATEGORIES)[number], string> = {
  Discovery: 'broad "what/which tools for <problem>" questions, no brand named',
  Evaluation:
    'capability, feature, and how-to questions about solving the problem',
  Comparison: '"best X", alternatives, and "<brand> vs <competitor>" questions',
  Decision: 'pricing, "is it worth it", and fit-for-<use-case> questions',
  Authority:
    'industry / thought-leadership questions an expert brand might be cited for',
};

const generatedPromptsSchema = z.object({
  prompts: z
    .array(
      z.object({ text: z.string().catch(''), category: z.string().catch('') }),
    )
    .catch([]),
});

// 25 prompt objects per response: a token cap that binds here truncates the
// array mid-item and parseJson loses the whole draft, so the json_schema
// bounds the shape and no token ceiling applies (see extractMeta).
const generatedPromptsResponseFormat = {
  type: 'json_schema' as const,
  json_schema: {
    name: 'prompts',
    schema: {
      type: 'object',
      properties: {
        prompts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              category: { type: 'string' },
            },
            required: ['text', 'category'],
            additionalProperties: false,
          },
        },
      },
      required: ['prompts'],
      additionalProperties: false,
    },
  },
};

export interface GeneratedPrompt {
  text: string;
  category: string;
}

export type PromptGeneration =
  | { ok: true; prompts: GeneratedPrompt[] }
  | { ok: false; cause: 'model_unreachable' | 'unparseable' | 'empty_output' };

// Generate the buyer questions to monitor. Loose validation here (structure
// only); the caller sanitises text (length) + category membership + dedupe.
// Failures name their cause so the step can degrade with a diagnostic.
export const generatePrompts = async (
  env: AppEnv,
  input: {
    brand: string;
    domain: string;
    summary: string;
    competitors: string[];
    total?: number;
    focus?: string;
  },
): Promise<PromptGeneration> => {
  const cats = PROMPT_CATEGORIES.map(
    (c) => `- ${c}: ${CATEGORY_HINTS[c]}`,
  ).join('\n');
  const total = input.total ?? 25;
  const perCategory = Math.ceil(total / PROMPT_CATEGORIES.length);
  const system =
    `You generate the questions a potential buyer asks an AI assistant (ChatGPT, Perplexity, Gemini) while researching a purchase in ${input.brand}'s category. ` +
    'They measure whether AI answers surface the brand, so **most questions must NOT name the brand** — they are generic problem/category questions (only some Comparison questions may name the brand and a competitor). ' +
    'Return ONLY a JSON object {"prompts":[{"text":string,"category":string}]}. ' +
    `Generate ${total} prompts, roughly ${perCategory} per category spread across all of them. category must be one of these exact words:\n${cats}\n` +
    (input.focus ? `Weigh the set toward: ${input.focus}\n` : '') +
    'Each text is a natural, standalone question a real person would type.';
  const competitorsLine = input.competitors.length
    ? `Competitors: ${input.competitors.join(', ')}\n`
    : '';
  const user =
    `Brand: ${input.brand} (${input.domain})\n` +
    (input.summary ? `About: ${input.summary}\n` : '') +
    competitorsLine +
    `\nGenerate ${total} prompts (~${perCategory} per category).`;

  try {
    const text = await runChat(
      env,
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      {
        maxTokens: null,
        responseFormat: generatedPromptsResponseFormat,
      },
    );
    if (!text) {
      return { ok: false, cause: 'model_unreachable' };
    }
    const parsed = parseJson(text, generatedPromptsSchema);
    if (!parsed) {
      return { ok: false, cause: 'unparseable' };
    }
    if (parsed.prompts.length === 0) {
      return { ok: false, cause: 'empty_output' };
    }
    return { ok: true, prompts: parsed.prompts };
  } catch {
    return { ok: false, cause: 'model_unreachable' };
  }
};
