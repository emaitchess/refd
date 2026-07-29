// Structural prominence: where in the answer's anatomy a mention span sits.
// Parsed with the same remark stack the SPA renders with, so server and client
// agree on structure by construction.

import type { Root } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

export type ProminenceTier = 'lead' | 'body' | 'list';

export interface TierRange {
  start: number;
  end: number;
  tier: ProminenceTier;
}

const parser = unified().use(remarkParse).use(remarkGfm);

// Root-level blocks only: a paragraph nested in a list item falls inside the
// list node's range and is tier "list". Lead = the first paragraph that
// precedes any list/table (headings before it don't disqualify it).
export const blockTiers = (markdown: string): TierRange[] => {
  const root: Root = parser.parse(markdown);
  const ranges: TierRange[] = [];
  let leadAssigned = false;
  let sawListLike = false;
  for (const node of root.children) {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) {
      continue;
    }
    let tier: ProminenceTier = 'body';
    if (node.type === 'list' || node.type === 'table') {
      tier = 'list';
      sawListLike = true;
    } else if (node.type === 'paragraph' && !leadAssigned && !sawListLike) {
      tier = 'lead';
      leadAssigned = true;
    }
    ranges.push({ start, end, tier });
  }
  return ranges;
};

const TIER_RANK: Record<ProminenceTier, number> = { lead: 0, body: 1, list: 2 };

// Best (most prominent) tier among an entity's mention spans; null when the
// entity has no spans. A span between blocks can't happen (spans match text),
// but degrade to "body" rather than dropping it if a parser gap ever appears.
export const bestTier = (
  spans: { start: number }[],
  ranges: TierRange[],
): ProminenceTier | null => {
  let best: ProminenceTier | null = null;
  for (const span of spans) {
    const range = ranges.find(
      (r) => span.start >= r.start && span.start < r.end,
    );
    const tier = range?.tier ?? 'body';
    if (best === null || TIER_RANK[tier] < TIER_RANK[best]) {
      best = tier;
    }
  }
  return best;
};
