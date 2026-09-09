import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import {
  entityScores,
  prompts,
  results,
  runs,
  setupCommits,
} from '../db/schema';
import type { AppEnv } from '../env';
import { loadEntitiesWithBrand } from '../routes/metrics';

export type SetupReportStatus =
  | 'queued'
  | 'running'
  | 'enriching'
  | 'ready'
  | 'partial'
  | 'failed';

export interface SetupReport {
  setupId: number;
  status: SetupReportStatus;
  totals: {
    expected: number;
    received: number;
    succeeded: number;
    failed: number;
    sentimentPending: number;
  };
  runs: {
    id: number;
    key: string;
    status: string;
    okCount: number;
    totalCount: number;
    dispatchState: string;
  }[];
  report: {
    tiles: { mentionRate: number | null; citationRate: number | null };
    surfaces: {
      surface: string;
      mentionRate: number | null;
      citationRate: number | null;
    }[];
    competitors: {
      name: string;
      isBrand: boolean;
      mentionRate: number | null;
      citationRate: number | null;
      sentiment: 'positive' | 'neutral' | 'negative' | null;
    }[];
    prompts: {
      id: number;
      text: string;
      category: string;
      surface: string;
      sample: number;
      ok: boolean;
      answerPresent: boolean;
      mention: boolean;
      cite: boolean;
      sentiment: 'positive' | 'neutral' | 'negative' | null;
    }[];
  } | null;
  retryAfterSeconds: number | null;
  reportUrl: string | null;
}

const pct = (part: number, whole: number): number | null =>
  whole > 0 ? part / whole : null;

const statusOf = (
  runs: {
    status: string;
    dispatchState: string;
    okCount: number;
    totalCount: number;
  }[],
  sentimentPending: number,
): SetupReportStatus => {
  if (runs.length === 0) {
    return 'queued';
  }
  const collecting = runs.some(
    (run) => run.status === 'running' && run.dispatchState !== 'exhausted',
  );
  if (collecting) {
    return 'running';
  }
  const succeeded = runs.reduce((sum, run) => sum + run.okCount, 0);
  if (succeeded === 0) {
    return 'failed';
  }
  if (sentimentPending > 0) {
    return 'enriching';
  }
  const expected = runs.reduce((sum, run) => sum + run.totalCount, 0);
  return succeeded < expected ? 'partial' : 'ready';
};

// One report accessor for both surfaces: pinned to the setup commit's run
// group, so previous workspace history or retried attempts can never bleed in.
export const getSetupReport = async (
  db: Db,
  env: AppEnv,
  workspaceId: number,
  setupId?: number,
): Promise<SetupReport | null> => {
  const commit = setupId
    ? (
        await db
          .select()
          .from(setupCommits)
          .where(
            and(
              eq(setupCommits.id, setupId),
              eq(setupCommits.workspaceId, workspaceId),
            ),
          )
      )[0]
    : (
        await db
          .select()
          .from(setupCommits)
          .where(
            and(
              eq(setupCommits.workspaceId, workspaceId),
              eq(setupCommits.claimStatus, 'active'),
            ),
          )
      )[0];
  if (!commit) {
    return null;
  }
  const runIds = [commit.preliminaryRunId, commit.backgroundRunId].flatMap(
    (id) => (id === null ? [] : [id]),
  );
  const runRows = runIds.length
    ? await db
        .select({
          id: runs.id,
          key: runs.key,
          status: runs.status,
          okCount: runs.okCount,
          totalCount: runs.totalCount,
          dispatchState: runs.dispatchState,
        })
        .from(runs)
        .where(inArray(runs.id, runIds))
    : [];
  const resultRows = runIds.length
    ? await db
        .select({
          id: results.id,
          promptId: results.promptId,
          surface: results.surface,
          sample: results.sample,
          ok: results.ok,
          answerPresent: results.answerPresent,
        })
        .from(results)
        .where(inArray(results.runId, runIds))
    : [];
  const scoreRows = runIds.length
    ? await db
        .select({
          resultId: entityScores.resultId,
          entityId: entityScores.entityId,
          mentioned: entityScores.mentioned,
          cited: entityScores.cited,
          sentiment: entityScores.sentiment,
        })
        .from(entityScores)
        .innerJoin(results, eq(entityScores.resultId, results.id))
        .where(inArray(results.runId, runIds))
    : [];
  const trackedEntities = await loadEntitiesWithBrand(db, workspaceId);
  const promptRows = resultRows.length
    ? await db
        .select({
          id: prompts.id,
          text: prompts.text,
          tags: prompts.tags,
        })
        .from(prompts)
        .where(
          inArray(prompts.id, [
            ...new Set(resultRows.map((row) => row.promptId)),
          ]),
        )
    : [];

  const scoreable = resultRows.filter((row) => row.ok && row.answerPresent);
  const scoreByResult = new Map<number, typeof scoreRows>();
  for (const score of scoreRows) {
    scoreByResult.set(score.resultId, [
      ...(scoreByResult.get(score.resultId) ?? []),
      score,
    ]);
  }
  const brand = trackedEntities.brand;
  const brandScores = brand
    ? scoreRows.filter((score) => score.entityId === brand.id)
    : [];
  const sentimentPending = [...scoreByResult.values()].filter((scores) =>
    scores.some((score) => score.mentioned && score.sentiment === null),
  ).length;

  const surfaceNames = [...new Set(resultRows.map((row) => row.surface))];
  const surfaces = surfaceNames.map((surface) => {
    const cells = scoreable.filter((row) => row.surface === surface);
    const mentioned = cells.filter((row) =>
      (scoreByResult.get(row.id) ?? []).some(
        (score) => score.entityId === brand?.id && score.mentioned,
      ),
    ).length;
    const cited = cells.filter((row) =>
      (scoreByResult.get(row.id) ?? []).some(
        (score) => score.entityId === brand?.id && score.cited,
      ),
    ).length;
    return {
      surface,
      mentionRate: pct(mentioned, cells.length),
      citationRate: pct(cited, cells.length),
    };
  });

  const competitorReport = trackedEntities.entities.map((entity) => {
    const scores = scoreRows.filter((score) => score.entityId === entity.id);
    const mentioned = scores.filter((score) => score.mentioned).length;
    const cited = scores.filter((score) => score.cited).length;
    const sentiments = scores.map((score) => score.sentiment);
    const positive = sentiments.filter((s) => s === 'positive').length;
    const negative = sentiments.filter((s) => s === 'negative').length;
    return {
      name: entity.name,
      isBrand: entity.isBrand,
      mentionRate: pct(mentioned, scores.length),
      citationRate: pct(cited, scores.length),
      sentiment:
        positive + negative === 0
          ? null
          : positive >= negative
            ? ('positive' as const)
            : ('negative' as const),
    };
  });

  const promptReport = promptRows.map((prompt) => {
    const cells = resultRows.filter((row) => row.promptId === prompt.id);
    const primary = cells[0];
    const cellScores = primary ? (scoreByResult.get(primary.id) ?? []) : [];
    const brandCellScores = brand
      ? cellScores.filter((score) => score.entityId === brand.id)
      : [];
    return {
      id: prompt.id,
      text: prompt.text,
      category: prompt.tags[0] ?? 'Other',
      surface: primary?.surface ?? '',
      sample: primary?.sample ?? 0,
      ok: cells.some((cell) => cell.ok),
      answerPresent: cells.some((cell) => cell.ok && cell.answerPresent),
      mention: brandCellScores.some((score) => score.mentioned),
      cite: brandCellScores.some((score) => score.cited),
      sentiment:
        brandCellScores.find((score) => score.sentiment !== null)?.sentiment ??
        null,
    };
  });

  const status = statusOf(runRows, sentimentPending);
  const expected = runRows.reduce((sum, run) => sum + run.totalCount, 0);
  const succeeded = runRows.reduce((sum, run) => sum + run.okCount, 0);
  const reportReady =
    status === 'ready' || status === 'partial' || status === 'enriching';

  return {
    setupId: commit.id,
    status,
    totals: {
      expected,
      received: resultRows.length,
      succeeded,
      failed: expected - succeeded,
      sentimentPending,
    },
    runs: runRows,
    report: reportReady
      ? {
          tiles: {
            mentionRate: pct(
              brandScores.filter((score) => score.mentioned).length,
              brandScores.length,
            ),
            citationRate: pct(
              brandScores.filter((score) => score.cited).length,
              brandScores.length,
            ),
          },
          surfaces,
          competitors: competitorReport,
          prompts: promptReport,
        }
      : null,
    retryAfterSeconds:
      status === 'queued' || status === 'running' || status === 'enriching'
        ? 10
        : null,
    reportUrl: env.DASHBOARD_ORIGIN
      ? `${env.DASHBOARD_ORIGIN}/w/${workspaceId}/onboarding/report/${commit.id}`
      : null,
  };
};
