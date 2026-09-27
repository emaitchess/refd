// Prompt-set versions: the identity of "which questions was this run measuring",
// so a trend can be read across a change of questions rather than over it.
//
// A version is minted the first time a population is measured and reused after
// that, which is what makes two runs comparable: identical prompt set, same
// version id. Its identity is the same promptSetHash the change engine's guard
// reads, so the version a run points at and the break the guard detects can never
// disagree.

import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { promptSetVersions, runs } from '../db/schema';

export interface ResolvedPromptSetVersion {
  id: number | null;
  hash: string | null;
  promptIds: number[];
  changeReason: string | null;
}

// `previous` is null when this is the workspace's first recorded population,
// which is a different statement from "nothing changed": reporting the first set
// as "3 added against the previous population" invents a prior state.
const describeChange = (previous: number[] | null, next: number[]): string => {
  if (previous === null) {
    return 'first recorded population for this workspace';
  }
  const before = new Set(previous);
  const after = new Set(next);
  const added = next.filter((id) => !before.has(id));
  const removed = previous.filter((id) => !after.has(id));
  if (added.length === 0 && removed.length === 0) {
    return 'same questions as the previous population';
  }
  const parts: string[] = [];
  if (added.length > 0) {
    parts.push(`${added.length} added`);
  }
  if (removed.length > 0) {
    parts.push(`${removed.length} removed`);
  }
  return `${parts.join(', ')} against the previous population`;
};

const planPromptIds = (plan: unknown): number[] => {
  const prompts = (plan as { prompts?: unknown } | null | undefined)?.prompts;
  if (!Array.isArray(prompts)) {
    return [];
  }
  return prompts
    .map((p) => (p as { id?: unknown }).id)
    .filter((id): id is number => typeof id === 'number')
    .sort((a, b) => a - b);
};

// Resolves the version for a frozen dispatch plan, minting one if this
// population has not been measured before. A plan with no prompt list (a legacy
// run) resolves to a null id rather than minting a version that claims to
// describe a population nobody recorded.
export const resolvePromptSetVersion = async (
  db: Db,
  workspaceId: number,
  plan: unknown,
  hash: string | null,
  surfaceIds: string[],
): Promise<ResolvedPromptSetVersion> => {
  const promptIds = planPromptIds(plan);
  if (hash === null || promptIds.length === 0) {
    return { id: null, hash: null, promptIds, changeReason: null };
  }

  const [existing] = await db
    .select()
    .from(promptSetVersions)
    .where(
      and(
        eq(promptSetVersions.workspaceId, workspaceId),
        eq(promptSetVersions.promptSetHash, hash),
      ),
    )
    .limit(1);
  if (existing) {
    return {
      id: existing.id,
      hash,
      promptIds,
      changeReason: existing.changeReason,
    };
  }

  // The most recent version is what this one is a change *from*, so the reason
  // reads as a delta rather than a bare hash.
  const [previous] = await db
    .select({ promptIds: promptSetVersions.promptIds })
    .from(promptSetVersions)
    .where(eq(promptSetVersions.workspaceId, workspaceId))
    .orderBy(desc(promptSetVersions.id))
    .limit(1);
  const changeReason = describeChange(previous?.promptIds ?? null, promptIds);

  const inserted = (
    await db
      .insert(promptSetVersions)
      .values({
        workspaceId,
        promptSetHash: hash,
        promptIds,
        surfaceIds,
        changeReason,
      })
      .returning({ id: promptSetVersions.id })
  )[0];
  // Null on conflict: another writer minted the same population first, which is
  // convergence, not an error, so the existing id is taken.
  if (inserted) {
    return { id: inserted.id, hash, promptIds, changeReason };
  }
  const [raced] = await db
    .select({ id: promptSetVersions.id })
    .from(promptSetVersions)
    .where(
      and(
        eq(promptSetVersions.workspaceId, workspaceId),
        eq(promptSetVersions.promptSetHash, hash),
      ),
    )
    .limit(1);
  return { id: raced?.id ?? null, hash, promptIds, changeReason };
};

export interface PromptSetTimelineEntry {
  versionId: number;
  promptSetHash: string;
  promptIds: number[];
  prompts: number;
  surfaceIds: string[];
  changeReason: string | null;
  label: string | null;
  createdAt: number;
  firstRunId: number | null;
  firstRunDate: string | null;
  runs: number;
}

// The workspace's measurement history, oldest first: every distinct population it
// has run against, what changed to get there, and how much was collected on it.
// This is the "what changed and when" timeline, and it is ordered by first run
// rather than creation, because a version created but never run measures nothing.
export const promptSetTimeline = async (
  db: Db,
  workspaceId: number,
): Promise<PromptSetTimelineEntry[]> => {
  const versions = await db
    .select()
    .from(promptSetVersions)
    .where(eq(promptSetVersions.workspaceId, workspaceId));
  if (versions.length === 0) {
    return [];
  }
  const usage = await db
    .select({
      versionId: runs.promptSetVersionId,
      runId: runs.id,
      date: runs.date,
    })
    .from(runs)
    .where(eq(runs.workspaceId, workspaceId));
  return versions
    .map((version) => {
      const forVersion = usage.filter((run) => run.versionId === version.id);
      const earliest = forVersion.reduce<(typeof forVersion)[number] | null>(
        (best, run) =>
          best === null ||
          run.date < best.date ||
          (run.date === best.date && run.runId < best.runId)
            ? run
            : best,
        null,
      );
      return {
        versionId: version.id,
        promptSetHash: version.promptSetHash,
        promptIds: version.promptIds,
        prompts: version.promptIds.length,
        surfaceIds: version.surfaceIds,
        changeReason: version.changeReason,
        label: version.label,
        createdAt: version.createdAt,
        firstRunId: earliest?.runId ?? null,
        firstRunDate: earliest?.date ?? null,
        runs: forVersion.length,
      };
    })
    .sort((a, b) =>
      a.firstRunDate === b.firstRunDate
        ? a.firstRunId === b.firstRunId
          ? a.versionId - b.versionId
          : (a.firstRunId ?? 0) - (b.firstRunId ?? 0)
        : a.firstRunDate === null
          ? 1
          : b.firstRunDate === null
            ? -1
            : a.firstRunDate < b.firstRunDate
              ? -1
              : 1,
    );
};
