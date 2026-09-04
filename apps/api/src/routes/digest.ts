// The grounded snapshot the Home assistant answers from, computed with the
// same pure metric functions as the dashboard — the model can only reference
// numbers that are real. Sections are keyed: an answer names which panels the
// client should render, and the chosen sections are frozen onto the message
// so old conversations keep showing what the reader originally saw.
import { composeAliases, findMentionSpans } from '@refd/core/mentions';
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

// A prompt counts as contested when a competitor owns the answer and the
// brand is effectively absent from it. Two rates rather than a gap: a prompt
// where both appear half the time is a race, not a loss.
const CONTESTED_LEADER = 0.5;
const CONTESTED_BRAND = 0.1;
const CONTESTED_MAX = 8;

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

export interface EntityStats {
  mentionRate: number | null;
  citationRate: number | null;
  sov: number | null;
  avgPosition: number | null;
  sentiment: { positive: number; neutral: number; negative: number } | null;
}

export interface NamedSide {
  prompts: number;
  mentionRate: number | null;
}

// Keyed by DigestPanel: the client renders each section as a real component,
// so the shape is a contract with the panel renderer, not an internal detail.
export interface DigestSections {
  overview: EntityStats & { answers: number };
  surfaces: {
    surface: string;
    mentionRate: number | null;
    citationRate: number | null;
    avgPosition: number | null;
    answers: number;
  }[];
  competitors: (EntityStats & { name: string; isBrand: boolean })[];
  sentiment: {
    brand: EntityStats['sentiment'];
    note: string;
  };
  sources: {
    topCited: { domain: string; isOurs: boolean; answersCiting: number }[];
    gap: { domain: string; answersCiting: number }[];
    gapNote: string;
  };
  coverage: ReturnType<typeof coverageStats>;
  prompts: {
    tracked: number;
    answered: number;
    top: { text: string; mentionRate: number | null }[];
    zeroVisibility: string[];
    zeroVisibilityCount: number;
    // Capped for prompt size; contestedCount is the true total.
    contested: {
      text: string;
      mentionRate: number | null;
      leader: string;
      leaderRate: number | null;
      answers: number;
    }[];
    contestedCount: number;
    namedSplit: { named: NamedSide; unnamed: NamedSide };
    namedSplitNote: string;
  };
  runs: {
    date: string;
    status: string;
    answersCollected: string;
    brandMentionRate: number | null;
  }[];
}

export interface WorkspaceDigest {
  brand: string;
  // Human-readable window ("last 30 days" / "all history") — disclosed in
  // the model prompt, the step trace, and frozen into panel data.
  rangeLabel: string;
  sections: DigestSections;
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
        id: p.id,
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

  // Prompts a competitor owns outright. This is the sharpest fact the digest
  // carries: an aggregate mention rate says the brand is losing, this says
  // where and to whom.
  const contested = promptStats
    .flatMap((p) => {
      if ((p.mentionRate ?? 0) > CONTESTED_BRAND) {
        return [];
      }
      const scope = byPrompt.get(p.id) ?? [];
      const leaders = allEntities
        .filter((e) => !e.isBrand)
        .map((e) => ({
          name: e.name,
          rate: cellRate(scope, e.id, 'mentioned'),
        }))
        .filter((e) => (e.rate ?? 0) >= CONTESTED_LEADER)
        .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));
      const leader = leaders[0];
      return leader
        ? [
            {
              text: p.text,
              mentionRate: p.mentionRate,
              leader: leader.name,
              leaderRate: r3(leader.rate),
              answers: p.answers,
            },
          ]
        : [];
    })
    .sort((a, b) => (b.leaderRate ?? 0) - (a.leaderRate ?? 0));

  // A prompt that names the brand is a different question from one that does
  // not, and pooling them flatters the headline: a workspace tracking two
  // "brand vs rival" prompts reads as visible when nothing unprompted found
  // it. Split on the same matcher the scorer uses, so "named" means exactly
  // what a mention means everywhere else.
  const brandMatcher = [
    {
      id: brand.id,
      aliases: composeAliases(brand.name, brand.domains, brand.aliases),
    },
  ];
  const namedSide = (named: boolean) => {
    const side = promptStats.filter(
      (p) => findMentionSpans(p.text, brandMatcher).length > 0 === named,
    );
    const answers = side.reduce((sum, p) => sum + p.answers, 0);
    return {
      prompts: side.length,
      mentionRate:
        answers === 0
          ? null
          : r3(
              side.reduce(
                (sum, p) => sum + (p.mentionRate ?? 0) * p.answers,
                0,
              ) / answers,
            ),
    };
  };

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

  const sections: DigestSections = {
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
      contested: contested.slice(0, CONTESTED_MAX),
      contestedCount: contested.length,
      namedSplit: { named: namedSide(true), unnamed: namedSide(false) },
      namedSplitNote:
        'prompts that spell out the brand vs prompts that do not; the second is unprompted visibility',
    },
    runs: runStats,
  };

  return { brand: brand.name, rangeLabel: rangeLabel(range), sections };
};
