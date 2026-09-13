import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../db/client';
import {
  entityScores,
  prompts,
  results,
  runs,
  setupCommits,
} from '../db/schema';
import type { AppEnv } from '../env';
import {
  answerCount,
  avgPosition,
  cellRate,
  coverageStats,
  firstMentionShare,
  loadCoverageRowsForRuns,
  loadEntitiesWithBrand,
  loadScoreRowsForRuns,
  pooledSov,
  type ScoreRow,
  sentimentDist,
  shareOf,
} from '../routes/metrics';

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
  // Same shapes the dashboard's broad endpoints served, scoped to exactly the
  // pinned run group — the report step consumes this instead.
  report: {
    tiles: {
      current: {
        mentionRate: number | null;
        citationRate: number | null;
        sov: number | null;
        citationSov: number | null;
        avgPosition: number | null;
        firstMentionShare: number | null;
        answers: number;
      } | null;
    };
    sentiment: { positive: number; neutral: number; negative: number } | null;
    coverage: {
      aio: { present: number; total: number } | null;
      sources: { withSources: number; total: number; surface: string }[];
    } | null;
    surfaces: {
      surface: string;
      mentionRate: number | null;
      citationRate: number | null;
      avgPosition: number | null;
      answers: number;
    }[];
    entities: {
      id: number;
      name: string;
      isBrand: boolean;
      sortOrder: number;
      mentionRate: number | null;
      citationRate: number | null;
    }[];
    prompts: {
      id: number;
      text: string;
      tags: string[];
      sentiment: { positive: number; neutral: number; negative: number } | null;
      surfaces: {
        surface: string;
        answers: number;
        mentionRate: number | null;
        citationRate: number | null;
      }[];
    }[];
  } | null;
  retryAfterSeconds: number | null;
  reportUrl: string | null;
}

const statusOf = (
  rows: { status: string; dispatchState: string; okCount: number }[],
  sentimentPending: number,
): SetupReportStatus => {
  if (rows.length === 0) {
    return 'queued';
  }
  if (
    rows.some(
      (run) => run.status === 'running' && run.dispatchState !== 'exhausted',
    )
  ) {
    return 'running';
  }
  const succeeded = rows.reduce((sum, run) => sum + run.okCount, 0);
  if (succeeded === 0) {
    return 'failed';
  }
  if (sentimentPending > 0) {
    return 'enriching';
  }
  return 'ready';
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

  const { entities: tracked, brand } = await loadEntitiesWithBrand(
    db,
    workspaceId,
  );
  if (!brand) {
    return null;
  }
  const hasCompetitors = tracked.some((e) => !e.isBrand);
  const scoreRows: ScoreRow[] = await loadScoreRowsForRuns(db, runIds);
  const coverageRows = await loadCoverageRowsForRuns(db, runIds);

  const allSentiment = sentimentDist(scoreRows, brand.id);
  // A result is sentiment-pending while any of its mentioned entity rows is
  // unclassified.
  const pendingRows = runIds.length
    ? await db
        .select({ resultId: entityScores.resultId })
        .from(entityScores)
        .innerJoin(results, eq(entityScores.resultId, results.id))
        .where(
          and(
            inArray(results.runId, runIds),
            eq(entityScores.mentioned, true),
            isNull(entityScores.sentiment),
          ),
        )
    : [];
  const sentimentPending = new Set(pendingRows.map((row) => row.resultId)).size;

  const tile = (scope: ScoreRow[]) => {
    if (scope.length === 0) {
      return null;
    }
    return {
      mentionRate: cellRate(scope, brand.id, 'mentioned'),
      citationRate: cellRate(scope, brand.id, 'cited'),
      sov: hasCompetitors
        ? shareOf(pooledSov(scope, 'mentioned'), brand.id)
        : null,
      citationSov: hasCompetitors
        ? shareOf(pooledSov(scope, 'cited'), brand.id)
        : null,
      avgPosition: avgPosition(scope, brand.id),
      firstMentionShare: shareOf(firstMentionShare(scope), brand.id),
      answers: answerCount(scope),
    };
  };

  const surfaces = [...new Set(scoreRows.map((r) => r.surface))]
    .sort()
    .map((surface) => {
      const scope = scoreRows.filter((r) => r.surface === surface);
      return {
        surface,
        mentionRate: cellRate(scope, brand.id, 'mentioned'),
        citationRate: cellRate(scope, brand.id, 'cited'),
        avgPosition: avgPosition(scope, brand.id),
        answers: answerCount(scope),
      };
    });

  const entityReport = tracked.map((entity) => ({
    id: entity.id,
    name: entity.name,
    isBrand: entity.isBrand,
    sortOrder: entity.sortOrder,
    mentionRate: cellRate(scoreRows, entity.id, 'mentioned'),
    citationRate: cellRate(scoreRows, entity.id, 'cited'),
  }));

  const promptIds = [...new Set(resultRows.map((row) => row.promptId))];
  const promptRows = promptIds.length
    ? await db
        .select({ id: prompts.id, text: prompts.text, tags: prompts.tags })
        .from(prompts)
        .where(inArray(prompts.id, promptIds))
    : [];
  const promptReport = promptRows.map((prompt) => {
    const surfacesForPrompt = [
      ...new Set(
        resultRows
          .filter((row) => row.promptId === prompt.id)
          .map((row) => row.surface),
      ),
    ].map((surface) => {
      const scope = scoreRows.filter(
        (row) => row.promptId === prompt.id && row.surface === surface,
      );
      return {
        surface,
        answers: scope.length,
        mentionRate: cellRate(scope, brand.id, 'mentioned'),
        citationRate: cellRate(scope, brand.id, 'cited'),
      };
    });
    const promptScoreRows = scoreRows.filter(
      (row) => row.promptId === prompt.id,
    );
    return {
      id: prompt.id,
      text: prompt.text,
      tags: prompt.tags,
      sentiment:
        promptScoreRows.length > 0
          ? sentimentDist(promptScoreRows, brand.id)
          : null,
      surfaces: surfacesForPrompt,
    };
  });

  const status = statusOf(runRows, sentimentPending);
  const expected = runRows.reduce((sum, run) => sum + run.totalCount, 0);
  const succeeded = runRows.reduce((sum, run) => sum + run.okCount, 0);
  const collecting =
    status === 'queued' || status === 'running' || status === 'enriching';

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
    report: {
      tiles: { current: tile(scoreRows) },
      sentiment: allSentiment,
      coverage: coverageRows.length > 0 ? coverageStats(coverageRows) : null,
      surfaces,
      entities: entityReport,
      prompts: promptReport,
    },
    retryAfterSeconds: collecting ? 10 : null,
    reportUrl: env.DASHBOARD_ORIGIN
      ? `${env.DASHBOARD_ORIGIN}/w/${workspaceId}/onboarding/report/${commit.id}`
      : null,
  };
};
