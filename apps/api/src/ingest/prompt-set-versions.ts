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
import { promptSetHash } from './runs';

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

// Mints a version for every distinct population a workspace's historical runs
// already carry, oldest population first, and points those runs at it.
//
// Without this the timeline only knows about runs created after this feature
// shipped, so a workspace with a month of history reports its newest population
// as "the first recorded population for this workspace" and omits every earlier
// one. That is worse than an empty timeline: the endpoint's own note tells a
// reader to compare within a version, and a short list makes that impossible to
// comply with while looking authoritative.
//
// The order matters and is derived from the runs, not the insert sequence: a
// population is labelled by what changed relative to the one measured before it
// in time, so minting out of order would describe each version against the
// wrong predecessor.
export const backfillPromptSetVersions = async (
  db: Db,
  workspaceId: number,
): Promise<{ minted: number; runsLinked: number }> => {
  const historical = await db
    .select({
      runId: runs.id,
      date: runs.date,
      dispatchPlan: runs.dispatchPlan,
      versionId: runs.promptSetVersionId,
    })
    .from(runs)
    .where(eq(runs.workspaceId, workspaceId))
    .then((rows) =>
      rows
        .map((row) => ({
          runId: row.runId,
          date: row.date,
          versionId: row.versionId,
          hash: promptSetHash(row.dispatchPlan),
          promptIds: planPromptIds(row.dispatchPlan),
          surfaceIds: surfacesFromPlan(row.dispatchPlan),
        }))
        .filter(
          (row): row is typeof row & { hash: string; promptIds: number[] } =>
            row.hash !== null && row.promptIds.length > 0,
        )
        .sort((a, b) =>
          a.date === b.date ? a.runId - b.runId : a.date < b.date ? -1 : 1,
        ),
    );
  if (historical.length === 0) {
    return { minted: 0, runsLinked: 0 };
  }

  const known = await db
    .select()
    .from(promptSetVersions)
    .where(eq(promptSetVersions.workspaceId, workspaceId));
  const byHash = new Map(known.map((v) => [v.promptSetHash, v]));

  // Oldest population first, so each version is described against its real
  // predecessor rather than whatever happened to be inserted last.
  const firstRunByHash = new Map<string, (typeof historical)[number]>();
  for (const run of historical) {
    if (!firstRunByHash.has(run.hash)) {
      firstRunByHash.set(run.hash, run);
    }
  }
  const ordered = [...firstRunByHash.values()].sort((a, b) =>
    a.date === b.date ? a.runId - b.runId : a.date < b.date ? -1 : 1,
  );

  let minted = 0;
  let previousIds: number[] | null = null;
  for (const population of ordered) {
    const existing = byHash.get(population.hash);
    if (existing) {
      previousIds = existing.promptIds;
      continue;
    }
    const inserted = (
      await db
        .insert(promptSetVersions)
        .values({
          workspaceId,
          promptSetHash: population.hash,
          promptIds: population.promptIds,
          surfaceIds: population.surfaceIds,
          changeReason: describeChange(previousIds, population.promptIds),
        })
        .returning({ id: promptSetVersions.id })
    )[0];
    if (inserted) {
      byHash.set(population.hash, {
        id: inserted.id,
        promptIds: population.promptIds,
      } as (typeof known)[number]);
      previousIds = population.promptIds;
      minted += 1;
    }
  }

  let runsLinked = 0;
  for (const run of historical) {
    if (run.versionId !== null) {
      continue;
    }
    const version = byHash.get(run.hash);
    if (!version) {
      continue;
    }
    await db
      .update(runs)
      .set({ promptSetVersionId: version.id })
      .where(eq(runs.id, run.runId));
    runsLinked += 1;
  }
  return { minted, runsLinked };
};

const surfacesFromPlan = (plan: unknown): string[] => {
  const surfaces = (plan as { surfaces?: unknown } | null | undefined)
    ?.surfaces;
  return Array.isArray(surfaces)
    ? surfaces.filter((s): s is string => typeof s === 'string')
    : [];
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
  // The hash is derived on read from each run's frozen dispatch plan, because a
  // stored column would be null for every run that predates the column. Reading
  // it back is what lets a pre-feature run be attributed to the population it
  // actually measured, which is the whole point of the history.
  const usage = await db
    .select({
      versionId: runs.promptSetVersionId,
      dispatchPlan: runs.dispatchPlan,
      runId: runs.id,
      date: runs.date,
    })
    .from(runs)
    .where(eq(runs.workspaceId, workspaceId))
    .then((rows) =>
      rows.map((row) => ({
        versionId: row.versionId,
        hash: promptSetHash(row.dispatchPlan),
        runId: row.runId,
        date: row.date,
      })),
    );
  const ordered = versions
    .map((version) => {
      // Matched by hash, not only by version id. A run recorded before this
      // feature existed carries the hash but a null version id, so an id-only
      // match reported a version's first run as the first run that pointed at
      // it, which understates the history and can put the first run after the
      // version that already existed. The hash is the identity the version was
      // keyed on, so it is the one that cannot drift.
      const forVersion = usage.filter(
        (run) =>
          run.versionId === version.id ||
          (run.hash !== null && run.hash === version.promptSetHash),
      );
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
  return ordered;
};

// Reads on demand rather than from a migration, because the version rows are
// derived from each run's frozen dispatch plan and a run is a far better place
// to read that from than a migration is. Idempotent: a population that already
// has a version is reused, and a run that already points at one is left alone.
export const ensurePromptSetHistory = async (
  db: Db,
  workspaceId: number,
): Promise<{ minted: number; runsLinked: number }> =>
  backfillPromptSetVersions(db, workspaceId);
