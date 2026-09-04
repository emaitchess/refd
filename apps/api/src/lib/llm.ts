import { z } from 'zod';
import type { AppEnv } from '../env';
import { validate } from './validate';

// One model for every LLM task. Smaller/newer Workers AI models were A/B'd for
// the extraction steps and measured much slower at equal quality —
// glm-4.7-flash ~2x, gemma-4-26b-a4b-it ~4x — because glm-5.2 is a fast,
// well-provisioned endpoint there. runChat still takes per-call opts (maxTokens).
export const LLM_MODEL = '@cf/zai-org/glm-5.2';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// A ceiling is a circuit breaker, not a length control: the budget is shared
// with the model's reasoning_content, so a cap that binds truncates the answer
// rather than shortening it, and bills the full budget for the wreckage. What
// actually bounds output is the prompt. `maxTokens: null` therefore means "no
// ceiling" and omits the field entirely; omitting the option keeps the legacy
// 1500 for callers that never chose a number.
export const tokenInputs = (maxTokens: number | null | undefined) =>
  maxTokens === null ? {} : { max_tokens: maxTokens ?? 1500 };

// glm models aren't in wrangler's generated Ai model union, so the binding is
// called through a loose shape. Returns the raw text response (or '').
export const runChat = async (
  env: AppEnv,
  messages: ChatMessage[],
  opts: { model?: string; maxTokens?: number | null } = {},
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
  const res = await ai.run(opts.model ?? LLM_MODEL, {
    messages,
    ...tokenInputs(opts.maxTokens),
  });
  // glm-5.2 answers OpenAI-style (choices[].message.content); other Workers AI
  // chat models use { response }. Accept both.
  const content = res?.choices?.[0]?.message?.content;
  if (typeof content === 'string' && content) {
    return content;
  }
  const out = res?.response;
  return typeof out === 'string' ? out : out == null ? '' : JSON.stringify(out);
};

// Streaming variant: Workers AI returns SSE bytes; each `data:` line carries
// either `{response}` (native models) or OpenAI-style `{choices[].delta}`.
// Both shapes are accepted per chunk. Resolves with the full text after the
// stream ends; onDelta fires per text fragment as it arrives.
export const runChatStream = async (
  env: AppEnv,
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  opts: { model?: string; maxTokens?: number | null } = {},
  onDelta?: (text: string) => void | Promise<void>,
): Promise<string> => {
  const ai = env.AI as unknown as {
    run: (
      model: string,
      inputs: Record<string, unknown>,
    ) => Promise<ReadableStream<Uint8Array>>;
  };
  const stream = await ai.run(opts.model ?? LLM_MODEL, {
    messages,
    ...tokenInputs(opts.maxTokens),
    stream: true,
  });
  const decoder = new TextDecoder();
  let buffered = '';
  let full = '';
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
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
        choices?: { delta?: { content?: unknown } }[];
      };
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
  return full;
};

// Locate the first balanced JSON object in a model response (models wrap JSON in
// prose or code fences often enough that a strict whole-string parse is too
// brittle) and validate it against a Zod schema. Returns null if there's no JSON
// or it fails validation — every caller degrades gracefully.
export const parseJson = <T>(raw: string, schema: z.ZodType<T>): T | null => {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  return validate(value, schema);
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

// Answers can be long (AI Mode especially); cap the prompt payload.
const SENTIMENT_TEXT_MAX = 12000;

// Classify how one AI answer portrays each mentioned entity, in a single
// call. Entities are referenced by number (the same trick as Exa competitor
// curation) so the model can never introduce one. Partial output is fine: a
// missing or malformed entry leaves that entity unclassified (null), never
// guessed. Returns null when the model answered but produced no parseable
// JSON, which callers treat as transient and retry rather than acking nulls
// forever.
//
// The token budget is shared with the model's reasoning_content, which is
// generated before any answer text and billed either way, so a cap that is
// too tight spends the whole budget on reasoning and returns nothing. Replayed
// over 44 stored answers: 800 tokens parsed 93.2% and covered 93.3% of
// mentions, 2000 parsed 100% and covered 99.3%. The wider cap also costs less
// than it looks, since a truncated call bills its full budget for unusable
// output and then retries.
export const classifySentiments = async (
  env: AppEnv,
  input: { answerText: string; entities: { id: number; name: string }[] },
): Promise<Map<number, Sentiment> | null> => {
  const system =
    'You judge how an AI-generated answer portrays specific brands or products. ' +
    "For each numbered entity, classify the answer's stance toward it: " +
    '"positive" (recommended, praised, or presented favourably), ' +
    '"negative" (criticised, discouraged, or unfavourably compared, including "unlike X" and "X lacks" framings), ' +
    '"neutral" (listed or described without clear valence). ' +
    'Return ONLY a JSON object {"sentiments":[{"entity":number,"sentiment":"positive"|"neutral"|"negative"}]} ' +
    'covering every numbered entity. Judge only the listed entities.';
  const list = input.entities.map((e, i) => `${i + 1}. ${e.name}`).join('\n');
  const user = `Entities:\n${list}\n\nAnswer:\n${input.answerText.slice(0, SENTIMENT_TEXT_MAX)}`;
  const text = await runChat(
    env,
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { maxTokens: 2000 },
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

export interface GeneratedPrompt {
  text: string;
  category: string;
}

// Generate the buyer questions to monitor. Loose validation here (structure
// only); the caller sanitises text (length) + category membership + dedupe.
// Returns [] on failure so the step degrades to manual entry.
export const generatePrompts = async (
  env: AppEnv,
  input: {
    brand: string;
    domain: string;
    summary: string;
    competitors: string[];
  },
): Promise<GeneratedPrompt[]> => {
  const cats = PROMPT_CATEGORIES.map(
    (c) => `- ${c}: ${CATEGORY_HINTS[c]}`,
  ).join('\n');
  const system =
    `You generate the questions a potential buyer asks an AI assistant (ChatGPT, Perplexity, Gemini) while researching a purchase in ${input.brand}'s category. ` +
    'They measure whether AI answers surface the brand, so **most questions must NOT name the brand** — they are generic problem/category questions (only some Comparison questions may name the brand and a competitor). ' +
    'Return ONLY a JSON object {"prompts":[{"text":string,"category":string}]}. ' +
    `Generate exactly 5 per category, 25 total. category must be one of these exact words:\n${cats}\n` +
    'Each text is a natural, standalone question a real person would type.';
  const competitorsLine = input.competitors.length
    ? `Competitors: ${input.competitors.join(', ')}\n`
    : '';
  const user =
    `Brand: ${input.brand} (${input.domain})\n` +
    (input.summary ? `About: ${input.summary}\n` : '') +
    competitorsLine +
    '\nGenerate 25 prompts (5 per category).';

  try {
    const text = await runChat(
      env,
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { maxTokens: 2000 },
    );
    return parseJson(text, generatedPromptsSchema)?.prompts ?? [];
  } catch {
    return [];
  }
};
