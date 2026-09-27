// Prompt-cohort persistence. Cohort membership is derived, not declared: a SQL
// migration cannot run the alias matcher (case folding, separator folding and
// per-alias caseSensitive flags all live in TS), so classification happens on
// the read that needs it. That makes the invariant airtight — a cohort number
// can never be reported from an unclassified row, because the read classifies
// first — and it needs no operator step or cron sweep.

import {
  type CohortEntity,
  classifyPromptCohort,
  type PromptKind,
} from '@refd/core/prompt-cohorts';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../db/client';
import { entities, prompts } from '../db/schema';

// A NULL kind is an unclassified prompt, never a cohort of its own. Reads treat
// it as discovery so an unclassified prompt is counted, not dropped.
export const promptKindOrDiscovery = (
  kind: string | null | undefined,
): PromptKind => (kind ?? 'discovery') as PromptKind;

const cohortEntities = async (
  db: Db,
  workspaceId: number,
): Promise<CohortEntity[]> =>
  db
    .select({
      id: entities.id,
      name: entities.name,
      domains: entities.domains,
      aliases: entities.aliases,
      isBrand: entities.isBrand,
    })
    .from(entities)
    .where(eq(entities.workspaceId, workspaceId));

// Resolves only NULL rows, so a kind set explicitly through update_prompt is
// never overwritten. The update repeats the IS NULL guard so two concurrent
// readers converge instead of racing.
export const classifyWorkspacePrompts = async (
  db: Db,
  workspaceId: number,
): Promise<number> => {
  const unclassified = await db
    .select({ id: prompts.id, text: prompts.text })
    .from(prompts)
    .where(and(eq(prompts.workspaceId, workspaceId), isNull(prompts.kind)));
  if (unclassified.length === 0) {
    return 0;
  }
  const tracked = await cohortEntities(db, workspaceId);
  for (const row of unclassified) {
    await db
      .update(prompts)
      .set({ kind: classifyPromptCohort(row.text, tracked) })
      .where(and(eq(prompts.id, row.id), isNull(prompts.kind)));
  }
  return unclassified.length;
};

export interface WorkspaceCohort {
  kind: PromptKind;
  promptIds: number[];
  prompts: number;
}

// Classifies, then buckets the workspace's prompts. A null filter returns null
// prompt ids, which every caller reads as "no prompt predicate" (blended).
export const workspaceCohorts = async (
  db: Db,
  workspaceId: number,
  filter: readonly PromptKind[] | null,
): Promise<WorkspaceCohort[] | null> => {
  await classifyWorkspacePrompts(db, workspaceId);
  if (filter === null) {
    return null;
  }
  const rows = await db
    .select({ id: prompts.id, kind: prompts.kind })
    .from(prompts)
    .where(
      filter.length === 0
        ? eq(prompts.workspaceId, workspaceId)
        : and(
            eq(prompts.workspaceId, workspaceId),
            inArray(prompts.kind, [...filter]),
          ),
    );
  return filter.map((kind) => {
    const promptIds = rows
      .filter((row) => promptKindOrDiscovery(row.kind) === kind)
      .map((row) => row.id);
    return { kind, promptIds, prompts: promptIds.length };
  });
};

export const promptIdsForCohorts = (
  cohorts: WorkspaceCohort[] | null,
): number[] | undefined =>
  cohorts === null
    ? undefined
    : [...new Set(cohorts.flatMap((cohort) => cohort.promptIds))];

const COHORT_LABEL: Record<PromptKind, string> = {
  branded: 'brand-named prompts only',
  competitor: 'competitor-named prompts only',
  discovery: 'prompts that name neither the brand nor a competitor',
};

// A headline that mixes cohorts has to say so: the number is real, but it is
// not the unprompted-visibility number most readers assume it is.
export const cohortScopeLabel = (filter: readonly PromptKind[] | null) =>
  filter === null
    ? 'blended across all prompt cohorts'
    : filter.map((kind) => COHORT_LABEL[kind]).join(' and ');
