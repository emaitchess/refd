// BrightData dataset ("Web Scraper") API — async: trigger → poll → snapshot.
// https://docs.brightdata.com/datasets/scrapers/chatgpt/introduction
import { z } from 'zod';
import type { AppEnv } from '../env';
import { validate } from '../lib/validate';
import { collectStringsAndUrls } from '../scoring';
import type { DatasetSurface, NormalizedAnswer } from './types';

const API_BASE = 'https://api.brightdata.com/datasets/v3';

// A 429/5xx from BrightData: retry with the server's Retry-After when given.
export class ProviderRetryableError extends Error {
  retryAfterSeconds: number | null;
  constructor(message: string, retryAfterSeconds: number | null = null) {
    super(message);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const throwForStatus = async (
  response: Response,
  context: string,
): Promise<never> => {
  const body = (await response.text()).slice(0, 300);
  const message = `brightdata ${response.status} on ${context}: ${body}`;
  if (response.status === 429 || response.status >= 500) {
    const header = response.headers.get('Retry-After');
    const parsed = header ? Number.parseInt(header, 10) : Number.NaN;
    throw new ProviderRetryableError(
      message,
      Number.isFinite(parsed) ? parsed : null,
    );
  }
  throw new Error(message);
};

// A raw fetch/stream failure — most often Workers' `Error: Network connection
// lost.` while reading a large snapshot body — is transient, not terminal.
// Surfacing it as retryable lets the queue's backoff recover it; otherwise one
// dropped connection fails a whole snapshot's prompts (consumer.ts retries only
// ProviderRetryableError). An already-classified 429/5xx passes through.
const netRetry = async <T>(
  context: string,
  op: () => Promise<T>,
): Promise<T> => {
  try {
    return await op();
  } catch (error) {
    if (error instanceof ProviderRetryableError) {
      throw error;
    }
    throw new ProviderRetryableError(`${context}: ${String(error)}`);
  }
};

const datasetId = (env: AppEnv, surface: DatasetSurface): string => {
  const ids: Record<DatasetSurface, string> = {
    chatgpt: env.BRIGHTDATA_DATASET_CHATGPT,
    perplexity: env.BRIGHTDATA_DATASET_PERPLEXITY,
    gemini: env.BRIGHTDATA_DATASET_GEMINI,
    google_ai_mode: env.BRIGHTDATA_DATASET_GOOGLE_AI_MODE,
  };
  const id = ids[surface];
  if (!id) {
    throw new Error(
      `Missing dataset id for ${surface} — set BRIGHTDATA_DATASET_${surface.toUpperCase()} in wrangler.jsonc (from the BrightData dashboard).`,
    );
  }
  return id;
};

const SURFACE_URLS: Record<DatasetSurface, string> = {
  chatgpt: 'https://chatgpt.com/',
  perplexity: 'https://www.perplexity.ai',
  gemini: 'https://gemini.google.com',
  google_ai_mode: 'https://google.com/aimode',
};

const buildInput = (env: AppEnv, surface: DatasetSurface, prompt: string) => {
  const base: Record<string, unknown> = {
    url: SURFACE_URLS[surface],
    prompt,
    country: env.GEO_COUNTRY,
  };
  if (surface === 'chatgpt') {
    base.web_search = true;
  }
  return base;
};

const headers = (env: AppEnv) => ({
  Authorization: `Bearer ${env.BRIGHTDATA_API_TOKEN}`,
  'Content-Type': 'application/json',
});

export const triggerBatch = async (
  env: AppEnv,
  surface: DatasetSurface,
  promptTexts: string[],
): Promise<string> => {
  const url = `${API_BASE}/trigger?dataset_id=${encodeURIComponent(datasetId(env, surface))}&include_errors=true`;
  const response = await fetch(url, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify(
      promptTexts.map((prompt) => buildInput(env, surface, prompt)),
    ),
  });
  if (!response.ok) {
    await throwForStatus(response, `trigger ${surface}`);
  }
  const raw = await response.json();
  const data = validate(raw, z.object({ snapshot_id: z.string().min(1) }));
  if (!data) {
    throw new Error(
      `brightdata trigger ${surface}: no snapshot_id in ${JSON.stringify(raw).slice(0, 200)}`,
    );
  }
  return data.snapshot_id;
};

export type SnapshotProgress = 'running' | 'ready' | 'failed';

export const checkProgress = async (
  env: AppEnv,
  snapshotId: string,
): Promise<SnapshotProgress> => {
  const response = await netRetry(`progress ${snapshotId} fetch`, () =>
    fetch(`${API_BASE}/progress/${encodeURIComponent(snapshotId)}`, {
      headers: headers(env),
    }),
  );
  if (!response.ok) {
    await throwForStatus(response, `progress ${snapshotId}`);
  }
  const data = validate(
    await netRetry(`progress ${snapshotId} body`, () => response.json()),
    z.object({ status: z.string().optional() }),
  );
  if (data?.status === 'ready') {
    return 'ready';
  }
  if (data?.status === 'failed') {
    return 'failed';
  }
  return 'running';
};

// Snapshots reach 40MB+. Streaming the body as NDJSON (one record per line)
// keeps memory flat and avoids a single ~40MB `response.text()` + `JSON.parse`
// spike near the isolate's memory ceiling — a plausible trigger for the dropped
// connections that fail these downloads. A JSON array (BrightData's other
// format) is still tolerated by buffering it whole, so a format change can't
// silently empty a snapshot.
export const readSnapshotRecords = async (
  body: ReadableStream<Uint8Array>,
): Promise<Record<string, unknown>[]> => {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const records: Record<string, unknown>[] = [];
  let buffer = '';
  let mode: 'unknown' | 'ndjson' | 'array' = 'unknown';

  const pushLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    const value = JSON.parse(trimmed);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      records.push(value as Record<string, unknown>);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    // { stream: true } holds back a trailing partial multi-byte char; the
    // argless flush at end-of-stream emits it.
    buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
    // The first non-whitespace byte disambiguates: '[' is a JSON array (buffer
    // it whole), anything else is NDJSON (drain complete lines as they arrive).
    if (mode === 'unknown' && buffer.trimStart()) {
      mode = buffer.trimStart().startsWith('[') ? 'array' : 'ndjson';
    }
    if (mode === 'ndjson') {
      let nl = buffer.indexOf('\n');
      while (nl !== -1) {
        pushLine(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf('\n');
      }
    }
    if (done) {
      break;
    }
  }

  if (mode === 'array') {
    const parsed = JSON.parse(buffer);
    if (!Array.isArray(parsed)) {
      // A non-array body is a status envelope, not records. Degrading it to []
      // once burned a whole surface as "no record for prompt" while the records
      // sat ready for download — so retry instead.
      throw new ProviderRetryableError(
        `snapshot body: non-array JSON (${buffer.length} chars)`,
      );
    }
    return parsed as Record<string, unknown>[];
  }
  // Flush the trailing line (NDJSON often omits a final newline).
  pushLine(buffer);
  // A lone object with no prompt echo is a status/error envelope, not data —
  // the same case json mode's "non-array body" guard caught. Retry it rather
  // than burning every prompt as "no record for prompt in snapshot".
  const [only] = records;
  if (records.length === 1 && only && recordPrompt(only) === null) {
    throw new ProviderRetryableError(
      'snapshot body: single record without a prompt (status envelope?)',
    );
  }
  return records;
};

export const fetchSnapshot = async (
  env: AppEnv,
  snapshotId: string,
): Promise<Record<string, unknown>[]> => {
  const response = await netRetry(`snapshot ${snapshotId} fetch`, () =>
    fetch(
      `${API_BASE}/snapshot/${encodeURIComponent(snapshotId)}?format=ndjson`,
      { headers: headers(env) },
    ),
  );
  // 202: the snapshot is still materializing even though /progress already
  // reports ready — observed on large (40MB+) snapshots. Retry, never parse.
  if (response.status === 202) {
    throw new ProviderRetryableError(`snapshot ${snapshotId} building (202)`);
  }
  if (!response.ok) {
    await throwForStatus(response, `snapshot ${snapshotId}`);
  }
  const body = response.body;
  if (!body) {
    throw new ProviderRetryableError(
      `snapshot ${snapshotId}: no response body`,
    );
  }
  // Reading the large body is where a dropped connection surfaces as
  // `Network connection lost.` — stream it, and make the read retryable.
  return await netRetry(`snapshot ${snapshotId} download`, () =>
    readSnapshotRecords(body),
  );
};

// Records echo their input; match them back to prompts tolerantly.
export const recordPrompt = (
  record: Record<string, unknown>,
): string | null => {
  if (typeof record.prompt === 'string') {
    return record.prompt;
  }
  const input = record.input;
  if (typeof input === 'object' && input !== null && 'prompt' in input) {
    const prompt = (input as Record<string, unknown>).prompt;
    return typeof prompt === 'string' ? prompt : null;
  }
  return null;
};

const isBareRoot = (u: URL): boolean =>
  u.pathname === '/' && !u.search && !u.hash;

// Citation entries carry favicon/thumbnail URLs in their `icon` field (ChatGPT
// uses Google's favicon service, AI Mode gstatic thumbnails). Those are UI
// chrome, not citable sources — stored, they credit google.com as a top cited
// domain. Only services observed in real payloads are listed.
const isIconAsset = (url: string): boolean => {
  if (!URL.canParse(url)) {
    return false;
  }
  const u = new URL(url);
  return (
    u.hostname.endsWith('.gstatic.com') ||
    ((u.hostname === 'www.google.com' || u.hostname === 'google.com') &&
      u.pathname.startsWith('/s2/favicons'))
  );
};

// Perplexity citation entries carry a full URL in their `domain` field, so the
// walk yields a phantom site-root next to every real article URL. Keep a bare
// root only when no deeper URL from the same origin was collected — then it is
// the citation, not an artifact.
const dropRootArtifacts = (urls: string[]): string[] => {
  const deepOrigins = new Set(
    urls
      .filter((url) => URL.canParse(url) && !isBareRoot(new URL(url)))
      .map((url) => new URL(url).origin),
  );
  return urls.filter((url) => {
    if (!URL.canParse(url)) {
      return true;
    }
    const u = new URL(url);
    return !(isBareRoot(u) && deepOrigins.has(u.origin));
  });
};

// ChatGPT bakes a sponsored unit into the tail of every text variant of the
// answer and ships no structured ads payload to subtract (ads.carousel_cards:
// null in observed records). An advertiser must not score as an organic
// mention, so the unit is cut from the scored text. The cut is double-anchored
// — the literal "Ad … Sponsored options" terminator at the very end, plus the
// card copy located via the markdown's ad-image block — and skipped with a
// warning when either anchor is missing, so organic text is never over-trimmed.
const SPONSORED_END = /\bAd\s+Sponsored options\s*$/;
const MD_SPONSORED =
  /(?:!\[[^\]]*\]\([^)]*\)\s*)+([\s\S]+?)\s*\bAd\s+Sponsored options\s*$/;

const stripSponsoredTail = (text: string, markdown: unknown): string => {
  if (!SPONSORED_END.test(text)) {
    return text;
  }
  const md = typeof markdown === 'string' ? markdown : text;
  const match = MD_SPONSORED.exec(md);
  if (match) {
    if (text === md) {
      return text.slice(0, match.index).trimEnd();
    }
    const card = (match[1] ?? '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const firstWord = card.split(' ')[0] ?? '';
    const cut = firstWord ? text.lastIndexOf(firstWord) : -1;
    if (
      cut >= 0 &&
      text.slice(cut).replace(/\s+/g, ' ').trim() ===
        `${card} Ad Sponsored options`
    ) {
      return text.slice(0, cut).trimEnd();
    }
  }
  console.warn('brightdata: sponsored tail detected but unbounded, kept');
  return text;
};

export const normalizeDatasetRecord = (
  record: Record<string, unknown>,
): NormalizedAnswer => {
  const picked =
    [
      record.answer_text,
      record.answer_text_markdown,
      record.answer,
      record.response,
    ].find((v): v is string => typeof v === 'string' && v.trim().length > 0) ??
    '';
  const answerText = stripSponsoredTail(picked, record.answer_text_markdown);
  // Provider-labeled source structures only (citation tier 1). The walk keeps
  // arrival order, so the dedup below preserves source rank.
  const urls: string[] = [];
  collectStringsAndUrls(
    {
      citations: record.citations,
      sources: record.search_sources,
      links: record.links_attached,
    },
    [],
    urls,
  );
  return {
    answerText,
    sourceUrls: dropRootArtifacts(
      [...new Set(urls)].filter((url) => !isIconAsset(url)),
    ),
    answerPresent: true,
    raw: record,
  };
};
