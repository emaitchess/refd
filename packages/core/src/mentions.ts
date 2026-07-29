// Deterministic brand-mention matcher, shared by the Worker scorer and the SPA
// highlighter — one implementation, so a highlight appears iff the scorer
// counted that mention.

export interface Alias {
  value: string;
  // Dictionary-word aliases ("Notion", "Loop") must match their exact casing;
  // the default lane is case- and diacritic-insensitive.
  caseSensitive?: boolean;
}

export interface MatchEntity {
  id: number;
  aliases: Alias[];
}

export interface MentionSpan {
  start: number;
  end: number;
  entityId: number;
}

export interface EntityMentions {
  entityId: number;
  spans: { start: number; end: number }[];
  mentioned: boolean;
  mentionCount: number;
  firstOffset: number | null;
}

// The one place alias lists are assembled: name first, curated aliases, then
// each domain as a literal (a visible "ahrefs.com" in prose names the brand).
export const composeAliases = (
  name: string,
  domains: string[],
  aliases: Alias[] = [],
): Alias[] => {
  const out: Alias[] = [];
  const seen = new Set<string>();
  const all: Alias[] = [
    { value: name },
    ...aliases,
    ...domains.map((value) => ({ value })),
  ];
  for (const alias of all) {
    const value = alias.value.trim();
    const key = fold(value).folded;
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push({
      value,
      caseSensitive: alias.caseSensitive === true ? true : undefined,
    });
  }
  return out;
};

interface Folded {
  folded: string;
  // Per folded UTF-16 unit: [start, end) offsets of the source code point, so
  // matches on the folded text map back to exact original spans.
  starts: number[];
  ends: number[];
}

// NFKD → strip combining marks → lowercase, code point by code point. Folding
// per code point (not on the whole string) is what keeps the offset map exact
// even when one source char folds to several ("ﬁ" → "fi").
const fold = (text: string): Folded => {
  let folded = '';
  const starts: number[] = [];
  const ends: number[] = [];
  let i = 0;
  for (const cp of text) {
    const next = i + cp.length;
    const f = cp.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
    for (let j = 0; j < f.length; j += 1) {
      starts.push(i);
      ends.push(next);
    }
    folded += f;
    i = next;
  }
  return { folded, starts, ends };
};

// Markdown link/image destinations are not visible text — a brand inside an
// href is citation territory, not a mention. Masking with same-length spaces
// keeps every other offset stable.
const maskLinkTargets = (text: string): string =>
  text
    .replace(
      /(\]\()([^)]*)(\))/g,
      (_m, open: string, dest: string, close: string) =>
        open + ' '.repeat(dest.length) + close,
    )
    .replace(
      /^(\s{0,3}\[[^\]]+\]:\s+)(\S+)/gm,
      (_m, head: string, url: string) => head + ' '.repeat(url.length),
    );

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const SEP_CLASS = '[\\s\\-._/]+';

// Token-separator equivalence: "Coca-Cola" ≡ "Coca Cola" ≡ "coca.cola".
// Unicode letter/number boundaries; a trailing possessive needs no special
// case (an apostrophe is already a boundary). Known limitation: boundary
// assertions make unspaced CJK context unmatched — fixable per alias later.
const aliasPattern = (value: string): RegExp | null => {
  const tokens = value.split(/[\s\-._/]+/u).filter((t) => t.length > 0);
  if (tokens.length === 0) {
    return null;
  }
  const body = tokens.map(escapeRegex).join(SEP_CLASS);
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])`, 'gu');
};

// Joint scan over every entity's aliases at once. Overlaps resolve
// longest-match-wins ("Google Analytics" beats "Google" on the same words;
// earlier start, then earlier entity, breaks ties), so the result is a set of
// non-overlapping spans in reading order.
export const findMentionSpans = (
  text: string,
  entities: MatchEntity[],
): MentionSpan[] => {
  const masked = maskLinkTargets(text);
  const hay = fold(masked);
  const candidates: MentionSpan[] = [];

  for (const entity of entities) {
    for (const alias of entity.aliases) {
      const value = alias.value.trim();
      if (!value) {
        continue;
      }
      if (alias.caseSensitive) {
        const re = aliasPattern(value);
        if (!re) {
          continue;
        }
        for (const m of masked.matchAll(re)) {
          if (m.index === undefined) {
            continue;
          }
          candidates.push({
            start: m.index,
            end: m.index + m[0].length,
            entityId: entity.id,
          });
        }
      } else {
        const re = aliasPattern(fold(value).folded);
        if (!re) {
          continue;
        }
        for (const m of hay.folded.matchAll(re)) {
          if (m.index === undefined) {
            continue;
          }
          const start = hay.starts[m.index];
          const end = hay.ends[m.index + m[0].length - 1];
          if (start === undefined || end === undefined) {
            continue;
          }
          candidates.push({ start, end, entityId: entity.id });
        }
      }
    }
  }

  candidates.sort(
    (a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start,
  );
  const claimed: MentionSpan[] = [];
  for (const c of candidates) {
    if (!claimed.some((k) => c.start < k.end && k.start < c.end)) {
      claimed.push(c);
    }
  }
  return claimed.sort((a, b) => a.start - b.start);
};

export const findMentions = (
  text: string,
  entities: MatchEntity[],
): EntityMentions[] => {
  const spans = findMentionSpans(text, entities);
  return entities.map((entity) => {
    const own = spans
      .filter((s) => s.entityId === entity.id)
      .map(({ start, end }) => ({ start, end }));
    return {
      entityId: entity.id,
      spans: own,
      mentioned: own.length > 0,
      mentionCount: own.length,
      firstOffset: own[0]?.start ?? null,
    };
  });
};
