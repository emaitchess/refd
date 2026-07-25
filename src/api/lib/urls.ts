// Citation URL handling: normalization, redirector unwrapping, asset
// filtering, PSL-backed grouping, and entity attribution. Everything here is
// deterministic — same URL in, same citation out — so rescores converge.

import { getDomain } from 'tldts';

// Tracking params are stripped; everything else in the query is kept (it can
// be meaningful). srsltid is Google's merchant-center tracker, common on AIO
// links.
const TRACKING_PARAMS = new Set([
  'gclid',
  'fbclid',
  'msclkid',
  'dclid',
  'twclid',
  'gbraid',
  'wbraid',
  'srsltid',
  'mc_cid',
  'mc_eid',
]);

// Redirectors whose target is NOT recoverable from the URL itself. These are
// stored unattributable (host/registrableDomain null): they count in totals
// but must never credit a domain — least of all google.com.
const OPAQUE_REDIRECTORS = new Set(['vertexaisearch.cloud.google.com']);

// Static-asset hosts and extensions: markup, not sources.
const ASSET_HOST_SUFFIXES = ['.gstatic.com', '.googleusercontent.com'];
const ASSET_EXTENSIONS =
  /\.(?:png|jpe?g|gif|webp|avif|svg|ico|css|js|mjs|woff2?|ttf|mp4|webm)$/i;

const parseHttpUrl = (raw: string): URL | null => {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
};

// Decodable redirectors: the target lives in a query param.
const unwrapRedirect = (url: URL): URL => {
  const host = url.hostname;
  if (
    (host === 'www.google.com' || host === 'google.com') &&
    url.pathname === '/url'
  ) {
    const target =
      url.searchParams.get('q') ?? url.searchParams.get('url') ?? '';
    return parseHttpUrl(target) ?? url;
  }
  if (host === 'translate.google.com') {
    const target = url.searchParams.get('u') ?? '';
    return parseHttpUrl(target) ?? url;
  }
  return url;
};

export const isAssetUrl = (raw: string): boolean => {
  const url = parseHttpUrl(raw);
  if (!url) {
    return false;
  }
  if (ASSET_HOST_SUFFIXES.some((s) => url.hostname.endsWith(s))) {
    return true;
  }
  return ASSET_EXTENSIONS.test(url.pathname);
};

export interface NormalizedCitation {
  url: string;
  // Null host = unattributable (opaque redirector): counted, never credited.
  host: string | null;
  registrableDomain: string | null;
}

export const normalizeCitationUrl = (
  raw: string,
): NormalizedCitation | null => {
  const parsed = parseHttpUrl(raw);
  if (!parsed) {
    return null;
  }
  const url = unwrapRedirect(parsed);
  url.hash = '';
  for (const param of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(param) || param.startsWith('utm_')) {
      url.searchParams.delete(param);
    }
  }
  // URL normalizes scheme/host casing, default ports, and IDN → punycode.
  const href = url.href;
  if (OPAQUE_REDIRECTORS.has(url.hostname)) {
    return { url: href, host: null, registrableDomain: null };
  }
  return {
    url: href,
    host: url.hostname,
    registrableDomain: getDomain(url.hostname),
  };
};

// An entity domain entry is an apex ("ahrefs.com") or a specific host
// ("mybrand.substack.com"). Exact-label suffix match covers every subdomain
// without "notahrefs.com" false positives.
export const matchesDomainEntry = (host: string, entry: string): boolean => {
  const cleaned = entry.trim().toLowerCase();
  if (!cleaned) {
    return false;
  }
  return host === cleaned || host.endsWith(`.${cleaned}`);
};

// Longest matching entry wins when two entities claim one host (matching set
// is the run's frozen entity snapshot).
export const attributeHost = (
  host: string | null,
  entities: { id: number; domains: string[] }[],
): number | null => {
  if (!host) {
    return null;
  }
  let bestId: number | null = null;
  let bestLength = -1;
  for (const entity of entities) {
    for (const entry of entity.domains) {
      if (matchesDomainEntry(host, entry) && entry.length > bestLength) {
        bestId = entity.id;
        bestLength = entry.length;
      }
    }
  }
  return bestId;
};

// Inline citation harvest: every http(s) URL visible in the canonical answer
// markdown — link destinations and bare URLs alike are references a reader
// can follow.
export const inlineUrls = (answerText: string): string[] => {
  const found = answerText.match(/https?:\/\/[^\s)\]}"'<>]+/gi) ?? [];
  return found.map((u) => u.replace(/[.,;:!?]+$/, ''));
};
