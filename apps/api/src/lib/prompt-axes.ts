// Applying the declared intent axes to a prompt set.
//
// Both axes narrow the same way the cohort filter does: resolve the workspace's
// prompts, keep the rows whose declared value matches, and hand back ids. That
// keeps one resolution path per read, so a prompt the filter excluded cannot
// reach the aggregate, the per-surface split, or any list beside it.
//
// The difference from the cohort filter is what an absent filter means. Cohort
// defaults to discovery because a brand-named prompt inflates the number. An
// absent axis filter means every declared value, and the response says so: there
// is no such thing as an unprompted funnel stage, so there is nothing to default
// away.

import type { FunnelStage, QuestionType } from '@refd/core/prompt-axes';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { prompts } from '../db/schema';
import type { WorkspaceCohort } from './prompt-cohorts';
import { promptIdsForCohorts } from './prompt-cohorts';

export interface AxisFilter {
  funnelStage?: readonly FunnelStage[] | null;
  questionType?: readonly QuestionType[] | null;
}

export const hasAxisFilter = (filter: AxisFilter): boolean =>
  (filter.funnelStage != null && filter.funnelStage.length > 0) ||
  (filter.questionType != null && filter.questionType.length > 0);

export interface ResolvedAxes {
  // The ids every active filter admits, or null when none applied.
  promptIds: number[] | null;
  // Per-axis counts over the workspace's prompts, so a caller can see the shape
  // of the set it is being asked about rather than inferring it from a rate.
  stages: Record<FunnelStage, number>;
  types: Record<QuestionType, number>;
  undeclaredStage: number;
  undeclaredType: number;
}

export const resolveAxes = async (
  db: Db,
  workspaceId: number,
  cohorts: WorkspaceCohort[] | null,
  filter: AxisFilter,
): Promise<ResolvedAxes> => {
  const rows = await db
    .select({
      id: prompts.id,
      kind: prompts.kind,
      funnelStage: prompts.funnelStage,
      questionType: prompts.questionType,
    })
    .from(prompts)
    .where(eq(prompts.workspaceId, workspaceId));

  const stages = emptyStageCounts();
  const types = emptyTypeCounts();
  let undeclaredStage = 0;
  let undeclaredType = 0;
  const cohortIds =
    cohorts === null ? null : new Set(promptIdsForCohorts(cohorts) ?? []);

  for (const row of rows) {
    if (row.funnelStage === null) {
      undeclaredStage += 1;
    } else {
      stages[row.funnelStage] += 1;
    }
    if (row.questionType === null) {
      undeclaredType += 1;
    } else {
      types[row.questionType] += 1;
    }
  }

  if (!hasAxisFilter(filter)) {
    return { promptIds: null, stages, types, undeclaredStage, undeclaredType };
  }

  const admitted = rows
    .filter((row) => cohortIds === null || cohortIds.has(row.id))
    .filter(
      (row) =>
        filter.funnelStage == null ||
        filter.funnelStage.length === 0 ||
        (row.funnelStage !== null &&
          filter.funnelStage.includes(row.funnelStage)),
    )
    .filter(
      (row) =>
        filter.questionType == null ||
        filter.questionType.length === 0 ||
        (row.questionType !== null &&
          filter.questionType.includes(row.questionType)),
    )
    .map((row) => row.id);

  // An explicit empty list is a real filter that matched nothing, which must
  // yield no rows rather than every row. loadScoreRows reads an empty array as
  // "nothing matches" and an absent one as "everything", so this distinction is
  // load-bearing rather than defensive.
  return {
    promptIds: admitted,
    stages,
    types,
    undeclaredStage,
    undeclaredType,
  };
};

const emptyStageCounts = (): Record<FunnelStage, number> => ({
  awareness: 0,
  consideration: 0,
  decision: 0,
});

const emptyTypeCounts = (): Record<QuestionType, number> => ({
  informational: 0,
  navigational: 0,
  commercial: 0,
  transactional: 0,
});
