// Provider-agnostic scoring over NormalizedAnswer: one pass emits every atom
// — mention spans/counts/offsets/prominence via the shared matcher, citations
// with per-entity attribution — for the run's frozen entity snapshot.

import { bestTier, blockTiers, type ProminenceTier } from '@refd/core/blocks';
import { type Alias, composeAliases, findMentions } from '@refd/core/mentions';
import {
  attributeHost,
  inlineUrls,
  isAssetUrl,
  normalizeCitationUrl,
} from './lib/urls';
import type { NormalizedAnswer } from './providers/types';

// Bump on any change to scoring semantics; the rescore job replays R2 raws to
// lift older rows to the current version (0 = pre-versioned legacy scores).
export const SCORING_VERSION = 1;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

// Deep-walk the payload instead of hard-coding each provider's schema:
// parsed shapes drift, and a walk degrades to "missed nothing" rather than
// "silently missed everything" when a field moves. v2 keeps it strictly as
// the zero-URL citation fallback and for raw-payload text display — mention
// scoring reads only the canonical answer text.
export const collectStringsAndUrls = (
  node: unknown,
  texts: string[],
  urls: string[],
): void => {
  if (typeof node === 'string') {
    const trimmed = node.trim();
    // data: URIs (inline images in AIO payloads) are neither answer text nor
    // a citable URL — a base64 blob poisons both display and matching.
    if (/^data:/i.test(trimmed)) {
      return;
    }
    if (/^https?:\/\//i.test(trimmed)) {
      urls.push(trimmed);
    } else if (trimmed.length > 0) {
      texts.push(node);
    }
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      collectStringsAndUrls(item, texts, urls);
    }
    return;
  }
  if (isRecord(node)) {
    for (const value of Object.values(node)) {
      collectStringsAndUrls(value, texts, urls);
    }
  }
};

export interface ScorableEntity {
  id: number;
  name: string;
  domains: string[];
  aliases: Alias[];
  isBrand: boolean;
}

export interface EntityScore {
  entityId: number;
  mentioned: boolean;
  mentionCount: number;
  firstOffset: number | null;
  spans: { start: number; end: number }[];
  cited: boolean;
  citedCount: number;
  position: number | null;
  prominence: ProminenceTier | null;
  scoringVersion: number;
}

export type CitationOrigin = 'source_list' | 'inline' | 'walk';

export interface ScoredCitation {
  url: string;
  host: string | null;
  registrableDomain: string | null;
  entityId: number | null;
  origin: CitationOrigin;
  rank: number | null;
}

export interface ScoredResult {
  scores: EntityScore[];
  citations: ScoredCitation[];
  totalUrls: number;
}

// Three tiers by trust: the provider-labeled source list (ordered → rank),
// then inline links in the answer text, then — only when both found nothing —
// a deep-walk of the raw payload (schema-drift safety net). First tier to
// claim a normalized URL keeps it.
const buildCitations = (
  answer: NormalizedAnswer,
  entitiesToScore: ScorableEntity[],
): ScoredCitation[] => {
  if (!answer.answerPresent) {
    // No answer, no sources — walking the raw payload here would harvest
    // organic-results noise as citations.
    return [];
  }
  const byUrl = new Map<string, ScoredCitation>();
  const add = (raw: string, origin: CitationOrigin, rank: number | null) => {
    if (isAssetUrl(raw)) {
      return;
    }
    const normalized = normalizeCitationUrl(raw);
    if (!normalized || byUrl.has(normalized.url)) {
      return;
    }
    byUrl.set(normalized.url, {
      url: normalized.url,
      host: normalized.host,
      registrableDomain: normalized.registrableDomain,
      entityId: attributeHost(normalized.host, entitiesToScore),
      origin,
      rank,
    });
  };

  for (const [i, url] of answer.sourceUrls.entries()) {
    add(url, 'source_list', i + 1);
  }
  for (const url of inlineUrls(answer.answerText)) {
    add(url, 'inline', null);
  }
  if (byUrl.size === 0) {
    const walked: string[] = [];
    collectStringsAndUrls(answer.raw, [], walked);
    for (const url of walked) {
      add(url, 'walk', null);
    }
  }
  return [...byUrl.values()];
};

export const scoreResult = (
  answer: NormalizedAnswer,
  entitiesToScore: ScorableEntity[],
): ScoredResult => {
  const matchEntities = entitiesToScore.map((entity) => ({
    id: entity.id,
    aliases: composeAliases(entity.name, entity.domains, entity.aliases),
  }));
  const mentions = findMentions(answer.answerText, matchEntities);
  const tiers = blockTiers(answer.answerText);
  const citations = buildCitations(answer, entitiesToScore);

  const citedCounts = new Map<number, number>();
  for (const citation of citations) {
    if (citation.entityId !== null) {
      citedCounts.set(
        citation.entityId,
        (citedCounts.get(citation.entityId) ?? 0) + 1,
      );
    }
  }

  // Rank = order of first mention among tracked entities; ties are impossible
  // (spans never overlap).
  const ranked = mentions
    .filter((m) => m.firstOffset !== null)
    .sort((a, b) => (a.firstOffset ?? 0) - (b.firstOffset ?? 0))
    .map((m) => m.entityId);

  const scores: EntityScore[] = mentions.map((m) => {
    const rank = ranked.indexOf(m.entityId);
    const citedCount = citedCounts.get(m.entityId) ?? 0;
    return {
      entityId: m.entityId,
      mentioned: m.mentioned,
      mentionCount: m.mentionCount,
      firstOffset: m.firstOffset,
      spans: m.spans,
      cited: citedCount > 0,
      citedCount,
      position: rank === -1 ? null : rank + 1,
      prominence: bestTier(m.spans, tiers),
      scoringVersion: SCORING_VERSION,
    };
  });

  return { scores, citations, totalUrls: citations.length };
};
