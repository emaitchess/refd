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
  const response = await fetch(
    `${API_BASE}/progress/${encodeURIComponent(snapshotId)}`,
    {
      headers: headers(env),
    },
  );
  if (!response.ok) {
    await throwForStatus(response, `progress ${snapshotId}`);
  }
  const data = validate(
    await response.json(),
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

export const fetchSnapshot = async (
  env: AppEnv,
  snapshotId: string,
): Promise<Record<string, unknown>[]> => {
  const response = await fetch(
    `${API_BASE}/snapshot/${encodeURIComponent(snapshotId)}?format=json`,
    { headers: headers(env) },
  );
  // 202: the snapshot is still materializing even though /progress already
  // reports ready — observed on large (40MB+) snapshots. Retry, never parse.
  if (response.status === 202) {
    throw new ProviderRetryableError(`snapshot ${snapshotId} building (202)`);
  }
  if (!response.ok) {
    await throwForStatus(response, `snapshot ${snapshotId}`);
  }
  const bodyText = await response.text();
  let data: unknown;
  try {
    data = JSON.parse(bodyText);
  } catch {
    throw new ProviderRetryableError(
      `snapshot ${snapshotId}: unparseable body (${bodyText.length} bytes)`,
    );
  }
  if (!Array.isArray(data)) {
    // A 200 with a non-array body is a status envelope, not records.
    // Degrading it to [] once burned a whole 20-prompt surface as "no record
    // for prompt in snapshot" while the records sat ready for download.
    throw new ProviderRetryableError(
      `snapshot ${snapshotId}: non-array body: ${bodyText.slice(0, 200)}`,
    );
  }
  return data as Record<string, unknown>[];
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
