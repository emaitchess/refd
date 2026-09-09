import { and, eq, gte, isNull, type SQL, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { setupUsage } from '../db/schema';
import type { AppEnv } from '../env';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SECTION_FAILURES_PER_DAY = 3;
const MAX_USER_GENERATIONS_PER_DAY = 18;
const MAX_USER_REPORTS_PER_DAY = 1;
const MAX_USER_REPORTS_LIFETIME = 5;

const positiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const globalGenerationLimit = (env: AppEnv): number =>
  positiveInt(env.SETUP_GENERATION_DAILY_LIMIT, 500);
export const globalReportLimit = (env: AppEnv): number =>
  positiveInt(env.SETUP_REPORT_DAILY_LIMIT, 100);

export type GenerationSection = 'describe' | 'competitors' | 'prompts';

export type BudgetDecision =
  | { ok: true; claimId: number; existing: boolean }
  | { ok: false; retryAfterSeconds: number; limit: string };

const retryAfter = (ms: number): number => Math.max(1, Math.ceil(ms / 1000));

const dayStart = (now: number): number => {
  const date = new Date(now);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
};

const countRows = async (db: Db, where: SQL | undefined): Promise<number> => {
  const rows = await db
    .select({ n: sql<number>`count(*)` })
    .from(setupUsage)
    .where(where);
  return rows[0]?.n ?? 0;
};

const blocked = (retryMs: number, limit: string): BudgetDecision => ({
  ok: false,
  retryAfterSeconds: retryAfter(retryMs),
  limit,
});

const sectionRetry = (now: number): number => DAY_MS - (now % DAY_MS);

// Claims the attempt BEFORE any external work; the caller settles the outcome
// afterwards. A failure counts because an upstream service may still have
// charged for it.
export const claimGenerationAttempt = async (
  db: Db,
  env: AppEnv,
  input: {
    userId: number;
    workspaceId: number;
    section: GenerationSection;
    isAdmin: boolean;
    idempotencyKey?: string;
  },
): Promise<BudgetDecision> => {
  const now = Date.now();
  const sectionFailures = await countRows(
    db,
    and(
      eq(setupUsage.userId, input.userId),
      eq(setupUsage.kind, 'generate'),
      eq(setupUsage.section, input.section),
      eq(setupUsage.status, 'failed'),
      gte(setupUsage.createdAt, now - DAY_MS),
    ),
  );
  if (sectionFailures >= MAX_SECTION_FAILURES_PER_DAY) {
    return blocked(sectionRetry(now), 'section_retries');
  }
  if (!input.isAdmin) {
    const attempts = await countRows(
      db,
      and(
        eq(setupUsage.userId, input.userId),
        eq(setupUsage.kind, 'generate'),
        gte(setupUsage.createdAt, now - DAY_MS),
      ),
    );
    if (attempts >= MAX_USER_GENERATIONS_PER_DAY) {
      return blocked(sectionRetry(now), 'user_generations_daily');
    }
  }
  const global = await countRows(
    db,
    and(
      eq(setupUsage.kind, 'generate'),
      gte(setupUsage.createdAt, dayStart(now)),
    ),
  );
  if (global >= globalGenerationLimit(env)) {
    return blocked(sectionRetry(now), 'global_generations_daily');
  }

  const insert = db
    .insert(setupUsage)
    .values({
      userId: input.userId,
      workspaceId: input.workspaceId,
      kind: 'generate',
      section: input.section,
      status: 'claimed',
      idempotencyKey: input.idempotencyKey ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: setupUsage.id });
  const inserted = (await insert)[0];
  if (inserted) {
    return { ok: true, claimId: inserted.id, existing: false };
  }
  // Same idempotency key: concurrent callers share one claimed attempt.
  const existing = (
    await db
      .select({ id: setupUsage.id })
      .from(setupUsage)
      .where(
        and(
          eq(setupUsage.userId, input.userId),
          input.idempotencyKey
            ? eq(setupUsage.idempotencyKey, input.idempotencyKey)
            : isNull(setupUsage.idempotencyKey),
        ),
      )
  )[0];
  if (existing) {
    return { ok: true, claimId: existing.id, existing: true };
  }
  return blocked(sectionRetry(now), 'global_generations_daily');
};

export const settleGenerationAttempt = async (
  db: Db,
  claimId: number,
  outcome: 'succeeded' | 'failed',
): Promise<void> => {
  await db
    .update(setupUsage)
    .set({ status: outcome, settledAt: Date.now() })
    .where(and(eq(setupUsage.id, claimId), eq(setupUsage.status, 'claimed')));
};

export type ReportClaimDecision =
  | { ok: true; claimId: number; existing: boolean }
  | {
      ok: false;
      retryAfterSeconds: number;
      limit:
        | 'workspace_claimed'
        | 'user_reports_daily'
        | 'user_reports_lifetime'
        | 'global_reports_daily';
    };

// One free report per workspace, claimed atomically before either run is
// created. The claim survives workspace deletion; only operator void-unspent
// or account deletion removes it.
export const claimFreeReport = async (
  db: Db,
  env: AppEnv,
  input: {
    userId: number;
    workspaceId: number;
    isAdmin: boolean;
    idempotencyKey?: string;
  },
): Promise<ReportClaimDecision> => {
  const now = Date.now();
  const existing = await countRows(
    db,
    and(
      eq(setupUsage.workspaceId, input.workspaceId),
      eq(setupUsage.kind, 'report'),
      sql`${setupUsage.status} in ('claimed', 'succeeded')`,
    ),
  );
  if (existing > 0) {
    return { ok: true, claimId: 0, existing: true };
  }
  if (!input.isAdmin) {
    const daily = await countRows(
      db,
      and(
        eq(setupUsage.userId, input.userId),
        eq(setupUsage.kind, 'report'),
        sql`${setupUsage.status} in ('claimed', 'succeeded')`,
        gte(setupUsage.createdAt, now - DAY_MS),
      ),
    );
    if (daily >= MAX_USER_REPORTS_PER_DAY) {
      return {
        ok: false,
        retryAfterSeconds: retryAfter(sectionRetry(now)),
        limit: 'user_reports_daily',
      };
    }
    const lifetime = await countRows(
      db,
      and(
        eq(setupUsage.userId, input.userId),
        eq(setupUsage.kind, 'report'),
        sql`${setupUsage.status} in ('claimed', 'succeeded')`,
      ),
    );
    if (lifetime >= MAX_USER_REPORTS_LIFETIME) {
      return {
        ok: false,
        retryAfterSeconds: retryAfter(DAY_MS),
        limit: 'user_reports_lifetime',
      };
    }
  }
  const global = await countRows(
    db,
    and(
      eq(setupUsage.kind, 'report'),
      gte(setupUsage.createdAt, dayStart(now)),
    ),
  );
  if (global >= globalReportLimit(env)) {
    return {
      ok: false,
      retryAfterSeconds: retryAfter(sectionRetry(now)),
      limit: 'global_reports_daily',
    };
  }

  const inserted = (
    await db
      .insert(setupUsage)
      .values({
        userId: input.userId,
        workspaceId: input.workspaceId,
        kind: 'report',
        status: 'claimed',
        idempotencyKey: input.idempotencyKey ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: setupUsage.id })
  )[0];
  if (inserted) {
    return { ok: true, claimId: inserted.id, existing: false };
  }
  // Lost a race against the same workspace's claim — that is the shared claim.
  const raced = (
    await db
      .select({ id: setupUsage.id })
      .from(setupUsage)
      .where(
        and(
          eq(setupUsage.workspaceId, input.workspaceId),
          eq(setupUsage.kind, 'report'),
        ),
      )
  )[0];
  if (raced) {
    return { ok: true, claimId: raced.id, existing: true };
  }
  return {
    ok: false,
    retryAfterSeconds: retryAfter(sectionRetry(now)),
    limit: 'global_reports_daily',
  };
};

// Operator-only void-unspent compensation: never deletes history, it appends a
// release and voids the original claim.
export const releaseReportClaim = async (
  db: Db,
  input: { claimId: number; userId: number; workspaceId: number },
): Promise<void> => {
  await db
    .update(setupUsage)
    .set({ status: 'void', settledAt: Date.now() })
    .where(
      and(eq(setupUsage.id, input.claimId), eq(setupUsage.kind, 'report')),
    );
  await db.insert(setupUsage).values({
    userId: input.userId,
    workspaceId: input.workspaceId,
    kind: 'report',
    status: 'void',
    idempotencyKey: `release:${input.claimId}`,
  });
};
