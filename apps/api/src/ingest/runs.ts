import { and, eq } from 'drizzle-orm';
import { type Db, getDb } from '../db/client';
import {
  entities,
  prompts,
  type RunDispatchState,
  runs,
  type SnapshotEntity,
  users,
  workspaces,
} from '../db/schema';
import type { AppEnv } from '../env';
import { configForUser } from '../lib/user-config';
import { enabledSurfaces } from '../providers/types';
import type { ScorableEntity } from '../scoring';
import { buildRunDispatchPlan, resumeRunDispatchWith } from './dispatch';
import type { RunPrompt } from './messages';

export const samplesFor = (env: AppEnv): number => {
  const parsed = Number.parseInt(env.SAMPLES, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

export const promptBatchSize = (env: AppEnv): number => {
  const parsed = Number.parseInt(env.PROMPT_BATCH_SIZE, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
};

export const loadEntitiesWith = async (
  db: Db,
  workspaceId: number,
): Promise<ScorableEntity[]> => {
  const rows = await db
    .select()
    .from(entities)
    .where(eq(entities.workspaceId, workspaceId))
    .orderBy(entities.sortOrder);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    domains: row.domains,
    aliases: row.aliases,
    isBrand: row.isBrand,
  }));
};

export const loadEntities = async (
  env: AppEnv,
  workspaceId: number,
): Promise<ScorableEntity[]> => loadEntitiesWith(getDb(env), workspaceId);

// The frozen set a run scores against; live entities only as a fallback for
// runs created before snapshots existed.
export const entitiesForRun = async (
  env: AppEnv,
  runId: number,
  workspaceId: number,
): Promise<ScorableEntity[]> => {
  const db = getDb(env);
  const row = (
    await db
      .select({ entitySnapshot: runs.entitySnapshot })
      .from(runs)
      .where(eq(runs.id, runId))
  )[0];
  return row?.entitySnapshot ?? loadEntities(env, workspaceId);
};

// Identity hash of the frozen set — trend charts draw break markers where
// consecutive runs differ (SOV/position moves from set edits are mechanical,
// not visibility events).
const entitySetHash = (snapshot: SnapshotEntity[]): string => {
  const identity = JSON.stringify(
    [...snapshot]
      .sort((a, b) => a.id - b.id)
      .map((e) => [
        e.id,
        e.name,
        e.isBrand,
        [...e.domains].sort(),
        e.aliases.map((a) => [a.value, a.caseSensitive === true]).sort(),
      ]),
  );
  let hash = 5381;
  for (let i = 0; i < identity.length; i += 1) {
    hash = ((hash * 33) ^ identity.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
};

export interface CreatedRun {
  runId: number;
  created: boolean;
  totalCount: number;
  dispatchState: RunDispatchState;
  dispatchAttempts: number;
}

// Idempotent by key ("cron:YYYY-MM-DD" | "manual:<uuid>"): a duplicate cron
// fire or double-submitted trigger becomes a no-op instead of a second run.
export const createRunWith = async (
  db: Db,
  env: AppEnv,
  workspaceId: number,
  trigger: 'cron' | 'manual' | 'onboard',
  key: string,
  date: string,
  // opts.promptIds restricts the run to a subset (onboarding preliminary run);
  // opts.samples overrides the default sample count (preliminary uses 1).
  opts: { promptIds?: number[]; samples?: number } = {},
): Promise<CreatedRun> => {
  const previous = (
    await db
      .select({
        id: runs.id,
        workspaceId: runs.workspaceId,
        totalCount: runs.totalCount,
      })
      .from(runs)
      .where(eq(runs.key, key))
  )[0];
  if (previous) {
    if (previous.workspaceId !== workspaceId) {
      throw new Error(`run key belongs to another workspace: ${key}`);
    }
    const dispatch = await resumeRunDispatchWith(db, env.INGEST, previous.id);
    if (!dispatch) {
      throw new Error(`run disappeared while resuming dispatch: ${key}`);
    }
    return {
      runId: previous.id,
      created: false,
      totalCount: previous.totalCount,
      dispatchState: dispatch.state,
      dispatchAttempts: dispatch.attempts,
    };
  }

  const ws = (
    await db
      .select({
        ownerEmail: users.email,
        surfaces: workspaces.surfaces,
      })
      .from(workspaces)
      .innerJoin(users, eq(workspaces.ownerUserId, users.id))
      .where(eq(workspaces.id, workspaceId))
  )[0];
  if (!ws) {
    throw new Error(`workspace ${workspaceId} not found`);
  }
  const config = configForUser(ws.ownerEmail, env.ADMIN_EMAILS);
  const promptSubset = opts.promptIds ? new Set(opts.promptIds) : null;
  const eligiblePrompts: RunPrompt[] = (
    await db
      .select()
      .from(prompts)
      .where(
        and(eq(prompts.active, true), eq(prompts.workspaceId, workspaceId)),
      )
      .orderBy(prompts.id)
  )
    .filter((p) => !promptSubset || promptSubset.has(p.id))
    .map((p) => ({ id: p.id, text: p.text }));
  const promptLimit = config.limits.maxActivePromptsPerWorkspace;
  const activePrompts =
    promptLimit === null
      ? eligiblePrompts
      : eligiblePrompts.slice(0, promptLimit);
  if (activePrompts.length === 0) {
    throw new Error('no active prompts, nothing to run');
  }

  const surfaces = enabledSurfaces(
    ws.surfaces,
    config.limits.maxEnabledSurfacesPerWorkspace,
  );
  const samples = opts.samples ?? samplesFor(env);
  const dispatchPlan = buildRunDispatchPlan({
    prompts: activePrompts,
    surfaces,
    samples,
    promptBatchSize: promptBatchSize(env),
  });
  const totalCount =
    activePrompts.length * surfaces.length * dispatchPlan.samples;

  // Freeze the entity set alongside the prompt set: every result in this run
  // scores against the same entities regardless of mid-run edits.
  const entitySnapshot = await loadEntitiesWith(db, workspaceId);

  const inserted = await db
    .insert(runs)
    .values({
      workspaceId,
      key,
      date,
      trigger,
      totalCount,
      entitySnapshot,
      entitySetHash: entitySetHash(entitySnapshot),
      dispatchPlan,
      dispatchState: 'pending',
    })
    .onConflictDoNothing({ target: runs.key })
    .returning({ id: runs.id });

  const insertedId = inserted[0]?.id;
  if (insertedId === undefined) {
    const existing = await db
      .select({
        id: runs.id,
        workspaceId: runs.workspaceId,
        totalCount: runs.totalCount,
      })
      .from(runs)
      .where(eq(runs.key, key));
    const run = existing[0];
    if (!run) {
      throw new Error(`run insert conflicted but key not found: ${key}`);
    }
    if (run.workspaceId !== workspaceId) {
      throw new Error(`run key belongs to another workspace: ${key}`);
    }
    const dispatch = await resumeRunDispatchWith(db, env.INGEST, run.id);
    if (!dispatch) {
      throw new Error(`run disappeared while resuming dispatch: ${key}`);
    }
    return {
      runId: run.id,
      created: false,
      totalCount: run.totalCount,
      dispatchState: dispatch.state,
      dispatchAttempts: dispatch.attempts,
    };
  }

  const dispatch = await resumeRunDispatchWith(db, env.INGEST, insertedId);
  if (!dispatch) {
    throw new Error(`new run disappeared while dispatching: ${key}`);
  }
  return {
    runId: insertedId,
    created: true,
    totalCount,
    dispatchState: dispatch.state,
    dispatchAttempts: dispatch.attempts,
  };
};

export const createRun = (
  env: AppEnv,
  workspaceId: number,
  trigger: 'cron' | 'manual' | 'onboard',
  key: string,
  date: string,
  opts: { promptIds?: number[]; samples?: number } = {},
) => createRunWith(getDb(env), env, workspaceId, trigger, key, date, opts);
