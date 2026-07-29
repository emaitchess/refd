// V2 aggregation (FEATURES.md "Metrics v2 — Decided"). The SQL layer only
// fetches per-result atoms; all math is pure JS below, unit-tested in
// metrics.test.ts. Denominators: scoreable = ok && answerPresent. A rate with
// an empty denominator is null (rendered "—"), never 0.

import type { Alias } from '@refd/core/mentions';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { entities, entityScores, results, runs } from '../db/schema';

export interface EntityInfo {
  id: number;
  name: string;
  domains: string[];
  aliases: Alias[];
  isBrand: boolean;
  sortOrder: number;
}

export const listEntities = async (
  db: Db,
  workspaceId: number,
): Promise<EntityInfo[]> => {
  const rows = await db
    .select()
    .from(entities)
    .where(eq(entities.workspaceId, workspaceId))
    .orderBy(entities.sortOrder);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    domains: r.domains,
    aliases: r.aliases,
    isBrand: r.isBrand,
    sortOrder: r.sortOrder,
  }));
};

// A workspace's entities plus its brand entity — the guard every brand-scoped
// route runs before querying (a workspace with no brand is not set up).
export const loadEntitiesWithBrand = async (db: Db, workspaceId: number) => {
  const list = await listEntities(db, workspaceId);
  return { entities: list, brand: list.find((e) => e.isBrand) };
};

// One entity-score atom from a scoreable result. Everything downstream
// (rates, SOV, position, prominence, trends) derives from arrays of these.
export interface ScoreRow {
  runId: number;
  date: string;
  entitySetHash: string | null;
  promptId: number;
  surface: string;
  sample: number;
  entityId: number;
  mentioned: boolean;
  cited: boolean;
  position: number | null;
  prominence: 'lead' | 'body' | 'list' | null;
  sentiment: 'positive' | 'neutral' | 'negative' | null;
}

export const loadScoreRows = async (
  db: Db,
  workspaceId: number,
  from: string,
  to = '9999-99-99',
): Promise<ScoreRow[]> =>
  db
    .select({
      runId: results.runId,
      date: runs.date,
      entitySetHash: runs.entitySetHash,
      promptId: results.promptId,
      surface: results.surface,
      sample: results.sample,
      entityId: entityScores.entityId,
      mentioned: entityScores.mentioned,
      cited: entityScores.cited,
      position: entityScores.position,
      prominence: entityScores.prominence,
      sentiment: entityScores.sentiment,
    })
    .from(entityScores)
    .innerJoin(results, eq(entityScores.resultId, results.id))
    .innerJoin(runs, eq(results.runId, runs.id))
    .where(
      and(
        eq(results.ok, true),
        eq(results.answerPresent, true),
        gte(runs.date, from),
        lt(runs.date, to),
        eq(runs.workspaceId, workspaceId),
      ),
    );

// Coverage pools include answerless results (they're the point): every ok
// result in range, scoreable or not.
export interface CoverageRow {
  surface: string;
  answerPresent: boolean;
  hasSources: boolean;
}

export const loadCoverageRows = async (
  db: Db,
  workspaceId: number,
  from: string,
): Promise<CoverageRow[]> =>
  db
    .select({
      surface: results.surface,
      answerPresent: results.answerPresent,
      hasSources: sql<boolean>`${results.totalUrls} > 0`,
    })
    .from(results)
    .innerJoin(runs, eq(results.runId, runs.id))
    .where(
      and(
        eq(results.ok, true),
        gte(runs.date, from),
        eq(runs.workspaceId, workspaceId),
      ),
    );

// ---------------------------------------------------------------------------
// Pure math. `rows` is any scope (a window, one run, one surface) — callers
// pre-filter; these never re-query.

// Mention/citation rate: per (run × prompt × surface) cell = hit samples ÷
// samples, then mean over cells with equal weight. Runs are never blended —
// each run contributes its own cells.
export const cellRate = (
  rows: ScoreRow[],
  entityId: number,
  key: 'mentioned' | 'cited',
): number | null => {
  const cells = new Map<string, { hits: number; n: number }>();
  for (const row of rows) {
    if (row.entityId !== entityId) {
      continue;
    }
    const cellKey = `${row.runId}:${row.promptId}:${row.surface}`;
    const cell = cells.get(cellKey) ?? { hits: 0, n: 0 };
    cell.n += 1;
    if (row[key]) {
      cell.hits += 1;
    }
    cells.set(cellKey, cell);
  }
  if (cells.size === 0) {
    return null;
  }
  let sum = 0;
  for (const cell of cells.values()) {
    sum += cell.hits / cell.n;
  }
  return sum / cells.size;
};

// Pooled SOV: presence counts over the scope, sum ÷ sum (deliberately not
// mean-of-cells — shares must sum to 100%). Null when the pool is empty; an
// entity absent from a non-empty pool is an honest 0.
export const pooledSov = (
  rows: ScoreRow[],
  key: 'mentioned' | 'cited',
): Map<number, number> | null => {
  const voice = new Map<number, number>();
  let total = 0;
  for (const row of rows) {
    if (row[key]) {
      voice.set(row.entityId, (voice.get(row.entityId) ?? 0) + 1);
      total += 1;
    }
  }
  if (total === 0) {
    return null;
  }
  const shares = new Map<number, number>();
  for (const [entityId, count] of voice) {
    shares.set(entityId, count / total);
  }
  return shares;
};

export const shareOf = (
  shares: Map<number, number> | null,
  entityId: number,
): number | null => (shares === null ? null : (shares.get(entityId) ?? 0));

// Conditional on mention — absence is mention rate's job, not position's.
export const avgPosition = (
  rows: ScoreRow[],
  entityId: number,
): number | null => {
  let sum = 0;
  let n = 0;
  for (const row of rows) {
    if (row.entityId === entityId && row.position !== null) {
      sum += row.position;
      n += 1;
    }
  }
  return n === 0 ? null : sum / n;
};

// Rank-1 events ÷ answers where any tracked entity is mentioned. Sums to
// 100% across entities: "when a winner exists, how often is it you".
export const firstMentionShare = (
  rows: ScoreRow[],
): Map<number, number> | null => {
  const answersWithWinner = new Set<string>();
  const rank1 = new Map<number, number>();
  for (const row of rows) {
    if (row.mentioned) {
      answersWithWinner.add(
        `${row.runId}:${row.promptId}:${row.surface}:${row.sample}`,
      );
      if (row.position === 1) {
        rank1.set(row.entityId, (rank1.get(row.entityId) ?? 0) + 1);
      }
    }
  }
  if (answersWithWinner.size === 0) {
    return null;
  }
  const shares = new Map<number, number>();
  for (const [entityId, count] of rank1) {
    shares.set(entityId, count / answersWithWinner.size);
  }
  return shares;
};

// Distribution over the entity's mentions (counts; UI renders percentages).
export const prominenceDist = (
  rows: ScoreRow[],
  entityId: number,
): { lead: number; body: number; list: number } | null => {
  const dist = { lead: 0, body: 0, list: 0 };
  let n = 0;
  for (const row of rows) {
    if (row.entityId === entityId && row.mentioned && row.prominence) {
      dist[row.prominence] += 1;
      n += 1;
    }
  }
  return n === 0 ? null : dist;
};

// Distribution over the entity's *classified* mentions. Unclassified (null)
// mentions are excluded from the denominator: sentiment lags scoring by a
// queue hop and pre-sentiment history is all null — neither is "neutral".
export const sentimentDist = (
  rows: ScoreRow[],
  entityId: number,
): { positive: number; neutral: number; negative: number } | null => {
  const dist = { positive: 0, neutral: 0, negative: 0 };
  let n = 0;
  for (const row of rows) {
    if (row.entityId === entityId && row.mentioned && row.sentiment) {
      dist[row.sentiment] += 1;
      n += 1;
    }
  }
  return n === 0 ? null : dist;
};

// AIO coverage ("AIO appeared on N% of prompts") + per-surface source
// coverage ("N% of answers carried sources"). Ratios as {hit, total} so the
// UI can show both the % and the honest sample size.
export const coverageStats = (rows: CoverageRow[]) => {
  let aioTotal = 0;
  let aioPresent = 0;
  const sources = new Map<string, { withSources: number; total: number }>();
  for (const row of rows) {
    if (row.surface === 'google_aio') {
      aioTotal += 1;
      if (row.answerPresent) {
        aioPresent += 1;
      }
    }
    if (row.answerPresent) {
      const s = sources.get(row.surface) ?? { withSources: 0, total: 0 };
      s.total += 1;
      if (row.hasSources) {
        s.withSources += 1;
      }
      sources.set(row.surface, s);
    }
  }
  return {
    aio: aioTotal === 0 ? null : { present: aioPresent, total: aioTotal },
    sources: [...sources.entries()].map(([surface, s]) => ({
      surface,
      ...s,
    })),
  };
};

// Distinct scoreable answers in scope (tile sample-size line).
export const answerCount = (rows: ScoreRow[]): number => {
  const seen = new Set<string>();
  for (const row of rows) {
    seen.add(`${row.runId}:${row.promptId}:${row.surface}:${row.sample}`);
  }
  return seen.size;
};

// One trend point per run. Carries the run's entitySetHash so charts can draw
// break markers where the tracked set changed (SOV/position shifts from set
// changes are mechanical, not visibility events).
export interface RunPoint {
  runId: number;
  date: string;
  entitySetHash: string | null;
  entities: Record<
    number,
    {
      mentionRate: number | null;
      citationRate: number | null;
      sov: number | null;
      citationSov: number | null;
      avgPosition: number | null;
    }
  >;
}

export const runSeries = (
  rows: ScoreRow[],
  entityIds: number[],
): RunPoint[] => {
  const byRun = new Map<number, ScoreRow[]>();
  for (const row of rows) {
    const bucket = byRun.get(row.runId) ?? [];
    bucket.push(row);
    byRun.set(row.runId, bucket);
  }
  return [...byRun.entries()]
    .map(([runId, runRows]) => {
      const first = runRows[0];
      const mentionSov = pooledSov(runRows, 'mentioned');
      const citedSov = pooledSov(runRows, 'cited');
      return {
        runId,
        date: first?.date ?? '',
        entitySetHash: first?.entitySetHash ?? null,
        entities: Object.fromEntries(
          entityIds.map((id) => [
            id,
            {
              mentionRate: cellRate(runRows, id, 'mentioned'),
              citationRate: cellRate(runRows, id, 'cited'),
              sov: shareOf(mentionSov, id),
              citationSov: shareOf(citedSov, id),
              avgPosition: avgPosition(runRows, id),
            },
          ]),
        ),
      };
    })
    .sort((a, b) =>
      a.date === b.date ? a.runId - b.runId : a.date < b.date ? -1 : 1,
    );
};
