// BrightData SERP API — sync. Google AI Overviews via brd_ai_overview=2,
// parsed JSON via brd_json=1. https://brightdata.com/products/serp-api/google-search/ai-overview
import { z } from 'zod';
import type { AppEnv } from '../env';
import { collectStringsAndUrls } from '../scoring';
import { ProviderRetryableError } from './brightdata';
import type { NormalizedAnswer } from './types';

// The AIO node's real shape (observed from live payloads, 2026-07): recursive
// blocks under `texts`, ordered sources under `references`.
//   { texts: [{ type: 'list'|'paragraph', title?, snippet?, list?: [...] }],
//     references: [{ href, title, index }], rank, global_rank }
// Blocks nest (list items can hold their own `list`). Item `links` are inline
// source chips that duplicate the reference list — ignored for citations.
// Every field is lenient: one malformed value must never discard the answer,
// and a fully unrecognized shape falls back to the deep walk.
interface AioBlock {
  type?: string;
  title?: string;
  snippet?: string;
  list?: AioBlock[];
}
const blockSchema: z.ZodType<AioBlock> = z.lazy(() =>
  z.looseObject({
    type: z.string().optional().catch(undefined),
    title: z.string().optional().catch(undefined),
    snippet: z.string().optional().catch(undefined),
    list: z.array(blockSchema).optional().catch(undefined),
  }),
);
const referenceSchema = z.looseObject({
  href: z.string().optional().catch(undefined),
  index: z.number().optional().catch(undefined),
});
const aioSchema = z.object({
  texts: z.array(blockSchema).catch([]),
  references: z.array(referenceSchema).catch([]),
});
type ParsedAio = z.infer<typeof aioSchema>;

const blockText = (block: AioBlock): string =>
  [block.title?.trim(), block.snippet?.trim()].filter(Boolean).join(': ');

// List items render as markdown bullets so the prominence pass tiers them
// "list"; nested lists indent. Whitespace collapses inside a bullet — an
// embedded blank line would split the item out of the list.
const bulletLines = (items: AioBlock[], depth: number): string[] =>
  items.flatMap((item) => {
    const text = blockText(item).replace(/\s+/g, ' ');
    const lines = text ? [`${'  '.repeat(depth)}- ${text}`] : [];
    if (item.list?.length) {
      lines.push(...bulletLines(item.list, depth + (text ? 1 : 0)));
    }
    return lines;
  });

// Canonical markdown from the AIO's structured blocks. Reference titles
// deliberately never enter the answer text (a brand in a source title is not
// a mention).
const structuredAioText = (aio: ParsedAio): string => {
  const parts: string[] = [];
  for (const block of aio.texts) {
    const text = blockText(block);
    if (block.list?.length) {
      parts.push(
        [text, ...bulletLines(block.list, 0)].filter(Boolean).join('\n'),
      );
    } else if (text) {
      parts.push(text);
    } else {
      // A block with neither text nor children carries its content in a field
      // this schema doesn't know (partial drift). Degrade by skipping it, but
      // loudly — otherwise a new block shape silently under-counts mentions.
      console.warn('serp: AIO block yielded no text', block.type ?? 'untyped');
    }
  }
  return parts.join('\n\n');
};

// Reference order is the provider's source ranking — preserve it (defensively
// by `index`) for the citation tier's rank.
const structuredAioSources = (aio: ParsedAio): string[] => {
  const refs = aio.references
    .flatMap((ref) => (ref.href ? [ref] : []))
    .sort(
      (a, b) =>
        (a.index ?? Number.MAX_SAFE_INTEGER) -
        (b.index ?? Number.MAX_SAFE_INTEGER),
    );
  return [...new Set(refs.map((ref) => ref.href ?? ''))].filter(Boolean);
};

// Structured-first; deep-walk only when the structured parse yields no answer
// text (schema drift — loud signal to update the schema above). Exported pure
// for tests.
export const parseAioNode = (
  aio: unknown,
): { answerText: string; sourceUrls: string[] } => {
  const structured = aioSchema.safeParse(aio);
  let answerText = structured.success ? structuredAioText(structured.data) : '';
  const sourceUrls = structured.success
    ? structuredAioSources(structured.data)
    : [];
  if (answerText.trim().length === 0) {
    console.warn('serp: AIO structured parse found no text, walking node');
    const texts: string[] = [];
    collectStringsAndUrls(aio, texts, []);
    answerText = texts.join('\n');
  }
  return { answerText, sourceUrls };
};

const REQUEST_ENDPOINT = 'https://api.brightdata.com/request';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

// The parsed SERP payload has carried the AI Overview under a few names as the
// product evolved — check them all, walk whichever is present.
const findAioNode = (parsed: Record<string, unknown>): unknown => {
  for (const key of ['ai_overview', 'aio', 'ai_overviews']) {
    if (key in parsed && parsed[key] != null) {
      return parsed[key];
    }
  }
  if (
    typeof parsed.aio_text === 'string' &&
    parsed.aio_text.trim().length > 0
  ) {
    return { texts: [{ type: 'paragraph', snippet: parsed.aio_text }] };
  }
  return null;
};

export const fetchAioAnswer = async (
  env: AppEnv,
  prompt: string,
): Promise<NormalizedAnswer> => {
  const searchUrl = new URL('https://www.google.com/search');
  searchUrl.searchParams.set('q', prompt);
  searchUrl.searchParams.set('gl', env.GEO_COUNTRY.toLowerCase());
  searchUrl.searchParams.set('hl', 'en');
  searchUrl.searchParams.set('brd_ai_overview', '2');
  searchUrl.searchParams.set('brd_json', '1');

  const response = await fetch(REQUEST_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.BRIGHTDATA_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      zone: env.BRIGHTDATA_SERP_ZONE,
      url: searchUrl.toString(),
      format: 'raw',
    }),
  });
  if (response.status === 429 || response.status >= 500) {
    const header = response.headers.get('Retry-After');
    const parsed = header ? Number.parseInt(header, 10) : Number.NaN;
    throw new ProviderRetryableError(
      `serp ${response.status}: ${(await response.text()).slice(0, 300)}`,
      Number.isFinite(parsed) ? parsed : null,
    );
  }
  if (!response.ok) {
    throw new Error(
      `serp ${response.status}: ${(await response.text()).slice(0, 300)}`,
    );
  }

  // Observed in the wild: 200 with an empty body. A transient provider glitch,
  // not a permanent failure — retry instead of dead-lettering the prompt.
  const bodyText = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    throw new ProviderRetryableError(
      `serp: unparseable 200 body (${bodyText.length} bytes)`,
      null,
    );
  }
  if (!isRecord(parsed)) {
    throw new Error('serp: unparseable response body');
  }

  const aio = findAioNode(parsed);
  if (!aio) {
    // Google served no AI Overview for this query — a valid observation.
    return {
      answerText: '',
      sourceUrls: [],
      answerPresent: false,
      raw: parsed,
    };
  }

  const { answerText, sourceUrls } = parseAioNode(aio);
  return {
    answerText,
    sourceUrls,
    answerPresent: true,
    // Store only the AIO node: full SERPs are huge, and the rest is organic
    // results noise that would poison the walk-fallback citation harvest.
    raw: aio,
  };
};
