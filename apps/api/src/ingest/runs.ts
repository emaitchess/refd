import { and, eq, gte, isNull, sql } from 'drizzle-orm';
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
import {
  buildRunDispatchPlan,
  messageCountFor,
  resumeRunDispatchWith,
} from './dispatch';
import type { RunPrompt } from './messages';
import { resolvePromptSetVersion } from './prompt-set-versions';

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

// djb2 over a canonical identity string, shared by both set hashes so a
// prompt-population break and an entity-population break are computed the
// same way and read the same way.
const djb2 = (identity: string): string => {
  let hash = 5381;
  for (let i = 0; i < identity.length; i += 1) {
    hash = ((hash * 33) ^ identity.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
};

// Identity hash of the frozen set — trend charts draw break markers where
// consecutive runs differ (SOV/position moves from set edits are mechanical,
// not visibility events).
const entitySetHash = (snapshot: SnapshotEntity[]): string =>
  djb2(
    JSON.stringify(
      [...snapshot]
        .sort((a, b) => a.id - b.id)
        .map((e) => [
          e.id,
          e.name,
          e.isBrand,
          [...e.domains].sort(),
          e.aliases.map((a) => [a.value, a.caseSensitive === true]).sort(),
        ]),
    ),
  );

// Identity of a frozen prompt population, the prompt-side twin of
// entitySetHash. Derived from the run's dispatch plan on read rather than
// stored in a column, because the plan already froze the population for every
// run: a stored column would be null for all pre-existing runs and would make
// every historical comparison read as a break it cannot prove. Null (a legacy
// run with no plan) means unknown, not changed, and the two are reported
// separately so a reader is never told a population moved when it is only
// unprovable.
export const promptSetHash = (plan: unknown): string | null => {
  const prompts = (plan as { prompts?: unknown } | null | undefined)?.prompts;
  if (!Array.isArray(prompts)) {
    return null;
  }
  const identity = prompts.map((p) => {
    const row = p as { id?: unknown; text?: unknown };
    return [row?.id ?? null, row?.text ?? null];
  });
  identity.sort((a, b) => Number(a[0] ?? 0) - Number(b[0] ?? 0));
  return djb2(JSON.stringify(identity));
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
      .where(
        and(
          eq(workspaces.id, workspaceId),
          isNull(workspaces.deletingAt),
          isNull(users.deletingAt),
        ),
      )
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

  // Resolve the prompt population's identity before the insert, so the run
  // points at the version that describes what it will measure. The hash is the
  // one the trend guard recomputes from the frozen plan, which is what keeps the
  // version and the detected break from ever disagreeing.
  const version = await resolvePromptSetVersion(
    db,
    workspaceId,
    dispatchPlan,
    promptSetHash(dispatchPlan),
    surfaces,
  );

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
      promptSetVersionId: version.id,
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

// Manual trigger spends provider quota. ADMIN_EMAILS is the server-side
// boundary enforced by the callers; the rate limit is a second cost guard,
// not authorization. Shared by the operator HTTP route and the MCP run_now
// tool so both surfaces drift-proof the same cost policy.
export const MANUAL_RUNS_PER_HOUR = 5;

export type ManualRunStart =
  | { ok: true; run: CreatedRun; date: string }
  | { ok: false; reason: 'rate_limited' };

// A preview is a plan, not a promise: it reports what createManualRun would do
// with the same arguments at the moment it was called. It is not a reservation,
// and a real run a second later can still be rate limited.
export type ManualRunPreview =
  | {
      ok: true;
      prompts: number;
      surfaces: string[];
      samples: number;
      providerRecords: number;
      queueMessages: number;
      promptLimit: number | null;
      excludedPromptIds: number[];
      runsUsedThisHour: number;
      runsRemainingThisHour: number;
      rateLimited: boolean;
      note: string;
    }
  | {
      ok: false;
      reason: 'no-workspace';
      runsUsedThisHour: number;
      runsRemainingThisHour: number;
    };

// What a manual run would cost, without buying it.
//
// createManualRun spends real provider quota, so "what would this run" and "run
// it" being one call is a footgun: the only way to learn the record count was to
// spend it. This plans the same dispatch the run would build and reports the
// shape of it, so an operator can check a prompt subset or a surface set before
// committing. It resolves nothing the real run does not, and dispatches nothing.
export const previewManualRun = async (
  db: Db,
  env: AppEnv,
  workspaceId: number,
  opts: { promptIds?: number[]; samples?: number } = {},
): Promise<ManualRunPreview> => {
  const hourAgo = Date.now() - 60 * 60 * 1000;
  const [recent] = await db
    .select({ count: sql<number>`count(*)` })
    .from(runs)
    .where(
      and(
        eq(runs.trigger, 'manual'),
        gte(runs.createdAt, hourAgo),
        eq(runs.workspaceId, workspaceId),
      ),
    );
  const used = recent?.count ?? 0;
  const remaining = Math.max(0, MANUAL_RUNS_PER_HOUR - used);

  const [ws] = await db
    .select({ surfaces: workspaces.surfaces, ownerEmail: users.email })
    .from(workspaces)
    .innerJoin(users, eq(workspaces.ownerUserId, users.id))
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (!ws) {
    return {
      ok: false,
      reason: 'no-workspace',
      runsUsedThisHour: used,
      runsRemainingThisHour: remaining,
    };
  }
  // The same limits the real run resolves, so a preview cannot describe a run
  // the ceiling would refuse.
  const config = configForUser(ws.ownerEmail, env.ADMIN_EMAILS);
  const surfaces = enabledSurfaces(
    ws.surfaces,
    config.limits.maxEnabledSurfacesPerWorkspace,
  );
  const samples = opts.samples ?? samplesFor(env);
  const promptSubset = opts.promptIds ? new Set(opts.promptIds) : null;

  const eligible = await db
    .select({ id: prompts.id, text: prompts.text })
    .from(prompts)
    .where(
      and(
        eq(prompts.workspaceId, workspaceId),
        eq(prompts.active, true),
        isNull(prompts.retiredBy),
      ),
    )
    .orderBy(prompts.id);
  const activePrompts = (
    promptSubset ? eligible.filter((p) => promptSubset.has(p.id)) : eligible
  ).map((p) => ({ id: p.id, text: p.text }));
  const promptLimit = config.limits.maxActivePromptsPerWorkspace;
  const selected =
    promptLimit === null
      ? activePrompts
      : activePrompts.slice(0, promptLimit ?? undefined);

  // A requested prompt that is not active is named rather than silently dropped,
  // because "run these 12" quietly running 9 is the failure this guards.
  const found = new Set(selected.map((p) => p.id));
  const excluded = opts.promptIds
    ? opts.promptIds.filter((id) => !found.has(id))
    : [];
  // An empty prompt set is a refusal, not a price: buildRunDispatchPlan requires
  // at least one prompt because a real run throws rather than collecting nothing.
  // The preview reports that shape without building a plan it cannot build.
  if (selected.length === 0) {
    return {
      ok: true,
      prompts: 0,
      surfaces,
      samples,
      providerRecords: 0,
      queueMessages: 0,
      promptLimit: promptLimit ?? null,
      excludedPromptIds: excluded,
      runsUsedThisHour: used,
      runsRemainingThisHour: remaining,
      rateLimited: remaining === 0,
      note: 'no active prompts to run, so this would spend nothing and the real run would fail',
    };
  }
  const dispatchPlan = buildRunDispatchPlan({
    prompts: selected,
    surfaces,
    samples,
    promptBatchSize: promptBatchSize(env),
  });

  return {
    ok: true,
    prompts: selected.length,
    surfaces,
    samples: dispatchPlan.samples,
    // What the run would actually cost: one provider record per prompt per
    // surface per sample.
    providerRecords: selected.length * surfaces.length * dispatchPlan.samples,
    // Queue messages, which is the number that decides whether a preview matches
    // what the run will actually cost in worker invocations. The AIO surface is
    // fetched per prompt rather than scraped, so it contributes a different
    // number of messages for the same records.
    queueMessages: messageCountFor(dispatchPlan),
    promptLimit: promptLimit ?? null,
    excludedPromptIds: excluded,
    runsUsedThisHour: used,
    runsRemainingThisHour: remaining,
    rateLimited: remaining === 0,
    note:
      selected.length === 0
        ? 'no active prompts to run, so this would spend nothing and fail'
        : excluded.length > 0
          ? `${excluded.length} requested prompt(s) are inactive or unknown and would be skipped`
          : `this run would spend ${selected.length * surfaces.length * dispatchPlan.samples} provider records`,
  };
};

export const createManualRun = async (
  db: Db,
  env: AppEnv,
  workspaceId: number,
  opts: { promptIds?: number[]; samples?: number } = {},
): Promise<ManualRunStart> => {
  const hourAgo = Date.now() - 60 * 60 * 1000;
  const recent = await db
    .select({ count: sql<number>`count(*)` })
    .from(runs)
    .where(
      and(
        eq(runs.trigger, 'manual'),
        gte(runs.createdAt, hourAgo),
        eq(runs.workspaceId, workspaceId),
      ),
    );
  if ((recent[0]?.count ?? 0) >= MANUAL_RUNS_PER_HOUR) {
    return { ok: false, reason: 'rate_limited' };
  }
  const date = new Date().toISOString().slice(0, 10);
  const run = await createRunWith(
    db,
    env,
    workspaceId,
    'manual',
    `manual:${crypto.randomUUID()}`,
    date,
    opts,
  );
  return { ok: true, run, date };
};
