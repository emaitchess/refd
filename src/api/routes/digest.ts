// The grounded snapshot the Home assistant answers from, computed with the
// same pure metric functions as the dashboard — the model can only reference
// numbers that are real. Sections are keyed: an answer names which panels the
// client should render, and the chosen sections are frozen onto the message
// so old conversations keep showing what the reader originally saw.
import { and, eq, gte, isNotNull, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { citations, entityScores, prompts, results, runs } from '../db/schema';
import { type Range, rangeLabel, rangeWindows } from '../lib/range';
import {
  answerCount,
  avgPosition,
  cellRate,
  coverageStats,
  loadCoverageRows,
  loadEntitiesWithBrand,
  loadScoreRows,
  pooledSov,
  type ScoreRow,
  sentimentDist,
  shareOf,
} from './metrics';

export const DIGEST_PANELS = [
  'overview',
  'surfaces',
  'competitors',
  'sentiment',
  'sources',
  'coverage',
  'prompts',
  'runs',
] as const;
export type DigestPanel = (typeof DIGEST_PANELS)[number];

// Rates travel as 0..1 with 3 decimals: compact JSON, no float noise.
const r3 = (v: number | null): number | null =>
  v === null ? null : Math.round(v * 1000) / 1000;

const entityStats = (rows: ScoreRow[], id: number) => {
  const sov = pooledSov(rows, 'mentioned');
  return {
    mentionRate: r3(cellRate(rows, id, 'mentioned')),
    citationRate: r3(cellRate(rows, id, 'cited')),
    sov: r3(shareOf(sov, id)),
    avgPosition: r3(avgPosition(rows, id)),
    sentiment: sentimentDist(rows, id),
  };
};

export interface WorkspaceDigest {
  brand: string;
  // Human-readable window ("last 30 days" / "all history") — disclosed in
  // the model prompt, the step trace, and frozen into panel data.
  rangeLabel: string;
  sections: Record<DigestPanel, unknown>;
}

// Null when the workspace has no brand yet (needsSetup).
export const buildDigest = async (
  db: Db,
  workspaceId: number,
  range: Range = '30d',
): Promise<WorkspaceDigest | null> => {
  const { entities: allEntities, brand } = await loadEntitiesWithBrand(
    db,
    workspaceId,
  );
  if (!brand) {
    return null;
  }
  const { from } = rangeWindows(range);
  const [rows, covRows] = await Promise.all([
    loadScoreRows(db, workspaceId, from),
    loadCoverageRows(db, workspaceId, from),
  ]);

  const inRange = and(
    eq(results.ok, true),
    gte(runs.date, from),
    eq(runs.workspaceId, workspaceId),
  );

  const [domains, gap, promptRows, runRows] = await Promise.all([
    db
      .select({
        domain: citations.registrableDomain,
        isOurs: sql<number>`max(case when ${citations.entityId} = ${brand.id} then 1 else 0 end)`,
        answersCiting: sql<number>`count(distinct ${citations.resultId})`,
      })
      .from(citations)
      .innerJoin(results, eq(citations.resultId, results.id))
      .innerJoin(runs, eq(results.runId, runs.id))
      .where(and(inRange, isNotNull(citations.registrableDomain)))
      .groupBy(citations.registrableDomain)
      .orderBy(sql`count(distinct ${citations.resultId}) desc`)
      .limit(8),
    db
      .select({
        domain: citations.registrableDomain,
        answersCiting: sql<number>`count(distinct ${citations.resultId})`,
      })
      .from(citations)
      .innerJoin(results, eq(citations.resultId, results.id))
      .innerJoin(runs, eq(results.runId, runs.id))
      .innerJoin(
        entityScores,
        and(
          eq(entityScores.resultId, results.id),
          eq(entityScores.entityId, brand.id),
        ),
      )
      .where(
        and(
          inRange,
          isNotNull(citations.registrableDomain),
          or(
            sql`${citations.entityId} is null`,
            sql`${citations.entityId} != ${brand.id}`,
          ),
          eq(entityScores.mentioned, false),
          eq(entityScores.cited, false),
        ),
      )
      .groupBy(citations.registrableDomain)
      .orderBy(sql`count(distinct ${citations.resultId}) desc`)
      .limit(8),
    db
      .select({ id: prompts.id, text: prompts.text, active: prompts.active })
      .from(prompts)
      .where(eq(prompts.workspaceId, workspaceId)),
    db
      .select({
        id: runs.id,
        date: runs.date,
        status: runs.status,
        okCount: runs.okCount,
        totalCount: runs.totalCount,
      })
      .from(runs)
      .where(eq(runs.workspaceId, workspaceId))
      .orderBy(sql`${runs.id} desc`)
      .limit(2),
  ]);

  // Per prompt: the brand's mention rate over answered cells in the window.
  const byPrompt = new Map<number, ScoreRow[]>();
  for (const row of rows) {
    const bucket = byPrompt.get(row.promptId) ?? [];
    bucket.push(row);
    byPrompt.set(row.promptId, bucket);
  }
  const promptStats = promptRows
    .map((p) => {
      const scope = byPrompt.get(p.id) ?? [];
      return {
        text: p.text,
        active: p.active,
        answers: answerCount(scope),
        mentionRate: r3(cellRate(scope, brand.id, 'mentioned')),
      };
    })
    .filter((p) => p.answers > 0);
  const byRate = [...promptStats].sort(
    (a, b) => (b.mentionRate ?? 0) - (a.mentionRate ?? 0),
  );
  const zeroVisibility = promptStats.filter((p) => p.mentionRate === 0);

  // Latest run vs the one before it: the brand's overall mention rate each.
  const runStats = runRows.map((run) => ({
    date: run.date,
    status: run.status,
    answersCollected: `${run.okCount}/${run.totalCount}`,
    brandMentionRate: r3(
      cellRate(
        rows.filter((r) => r.runId === run.id),
        brand.id,
        'mentioned',
      ),
    ),
  }));

  const surfaces = [...new Set(rows.map((r) => r.surface))].sort().map((s) => {
    const scope = rows.filter((r) => r.surface === s);
    return {
      surface: s,
      mentionRate: r3(cellRate(scope, brand.id, 'mentioned')),
      citationRate: r3(cellRate(scope, brand.id, 'cited')),
      avgPosition: r3(avgPosition(scope, brand.id)),
      answers: answerCount(scope),
    };
  });

  const sections: Record<DigestPanel, unknown> = {
    overview: {
      ...entityStats(rows, brand.id),
      answers: answerCount(rows),
    },
    surfaces,
    competitors: allEntities.map((e) => ({
      name: e.name,
      isBrand: e.isBrand,
      ...entityStats(rows, e.id),
    })),
    sentiment: {
      brand: sentimentDist(rows, brand.id),
      note: 'shares of classified mentions; null = nothing classified',
    },
    sources: {
      topCited: domains.map((d) => ({
        domain: d.domain ?? '',
        isOurs: d.isOurs === 1,
        answersCiting: d.answersCiting,
      })),
      gap: gap.map((g) => ({
        domain: g.domain ?? '',
        answersCiting: g.answersCiting,
      })),
      gapNote:
        'domains AI answers cite where the brand is neither mentioned nor cited',
    },
    coverage: coverageStats(covRows),
    prompts: {
      tracked: promptRows.length,
      answered: promptStats.length,
      top: byRate.slice(0, 5).map(({ text, mentionRate }) => ({
        text,
        mentionRate,
      })),
      zeroVisibility: zeroVisibility.slice(0, 5).map((p) => p.text),
      zeroVisibilityCount: zeroVisibility.length,
    },
    runs: runStats,
  };

  return { brand: brand.name, rangeLabel: rangeLabel(range), sections };
};
