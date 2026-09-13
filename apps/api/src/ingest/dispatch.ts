import { and, eq, gte, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type Db, getDb } from '../db/client';
import {
  type RunDispatchPlan,
  type RunDispatchState,
  runs,
} from '../db/schema';
import type { AppEnv } from '../env';
import { DATASET_SURFACES, SURFACES } from '../providers/types';
import type { IngestMessage, RunPrompt } from './messages';

const MAX_DISPATCH_ATTEMPTS = 3;
const DISPATCH_LEASE_MS = 60_000;
const DISPATCH_SWEEP_LIMIT = 20;
const MAX_DISPATCH_ERROR_LENGTH = 1_000;
const DISPATCH_RETRY_BASE_MS = 30_000;
const DISPATCH_RETRY_MAX_MS = 5 * 60_000;
const MAX_DISPATCH_PLAN_BYTES = 1_000_000;
const MAX_QUEUE_MESSAGE_BYTES = 120 * 1_024;
const MAX_QUEUE_BATCH_BYTES = 240 * 1_024;

const jsonByteLength = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

export const chunk = <T>(items: T[], size: number): T[][] => {
  const step = Math.max(1, size);
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += step) {
    batches.push(items.slice(i, i + step));
  }
  return batches;
};

const expectedMessageCount = (plan: {
  prompts: RunPrompt[];
  surfaces: RunDispatchPlan['surfaces'];
  samples: number;
  promptBatchSize: number;
}): number => {
  const datasetSurfaceCount = DATASET_SURFACES.filter((surface) =>
    plan.surfaces.includes(surface),
  ).length;
  const datasetBatches =
    datasetSurfaceCount * Math.ceil(plan.prompts.length / plan.promptBatchSize);
  const aioMessages = plan.surfaces.includes('google_aio')
    ? plan.prompts.length
    : 0;
  return plan.samples * (datasetBatches + aioMessages);
};

const persistedRunPromptSchema = z.object({
  id: z.number().int().positive(),
  text: z.string().min(1).max(500),
});

export const runDispatchPlanSchema = z
  .object({
    version: z.literal(1),
    prompts: z.array(persistedRunPromptSchema).min(1).max(10_000),
    surfaces: z.array(z.enum(SURFACES)).min(1).max(SURFACES.length),
    samples: z.number().int().positive().max(1_000),
    promptBatchSize: z.number().int().positive().max(10_000),
    expectedMessages: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((plan, ctx) => {
    if (
      new Set(plan.prompts.map((prompt) => prompt.id)).size !==
      plan.prompts.length
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['prompts'],
        message: 'prompt ids must be unique',
      });
    }
    const canonicalSurfaces = SURFACES.filter((surface) =>
      plan.surfaces.includes(surface),
    );
    if (
      canonicalSurfaces.length !== plan.surfaces.length ||
      canonicalSurfaces.some(
        (surface, index) => plan.surfaces[index] !== surface,
      )
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['surfaces'],
        message: 'surfaces must be unique and canonically ordered',
      });
    }
    if (plan.expectedMessages !== expectedMessageCount(plan)) {
      ctx.addIssue({
        code: 'custom',
        path: ['expectedMessages'],
        message: 'expected message count does not match the launch plan',
      });
    }
    if (jsonByteLength(plan) > MAX_DISPATCH_PLAN_BYTES) {
      ctx.addIssue({
        code: 'custom',
        message: 'dispatch plan exceeds the persisted size limit',
      });
    }
  });

export const buildRunDispatchPlan = (input: {
  prompts: RunPrompt[];
  surfaces: RunDispatchPlan['surfaces'];
  samples: number;
  promptBatchSize: number;
}): RunDispatchPlan => {
  const candidate = {
    version: 1 as const,
    ...input,
    expectedMessages: expectedMessageCount(input),
  };
  const parsed = runDispatchPlanSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(`invalid run dispatch plan: ${parsed.error.message}`);
  }
  return parsed.data;
};

export const messagesForRun = (
  plan: RunDispatchPlan,
  runId: number,
  workspaceId: number,
): IngestMessage[] => {
  const messages: IngestMessage[] = [];
  const promptBatches = chunk(plan.prompts, plan.promptBatchSize);
  const datasetSurfaces = DATASET_SURFACES.filter((surface) =>
    plan.surfaces.includes(surface),
  );
  for (let sample = 1; sample <= plan.samples; sample += 1) {
    for (const surface of datasetSurfaces) {
      promptBatches.forEach((batch, chunkIndex) => {
        messages.push({
          kind: 'brightdata_trigger',
          runId,
          workspaceId,
          surface,
          sample,
          chunk: chunkIndex,
          prompts: batch,
        });
      });
    }
    if (plan.surfaces.includes('google_aio')) {
      for (const prompt of plan.prompts) {
        messages.push({
          kind: 'serp_aio_fetch',
          runId,
          workspaceId,
          prompt,
          sample,
        });
      }
    }
  }
  return messages;
};

export const dispatchMessageBatches = async (
  messages: IngestMessage[],
  cursor: number,
  send: (batch: IngestMessage[]) => Promise<void>,
  markSent: (nextCursor: number) => Promise<void>,
): Promise<void> => {
  if (!Number.isInteger(cursor) || cursor < 0 || cursor > messages.length) {
    throw new Error('invalid run dispatch cursor');
  }
  let index = cursor;
  while (index < messages.length) {
    const batch: IngestMessage[] = [];
    let batchBytes = 2;
    while (index + batch.length < messages.length && batch.length < 100) {
      const message = messages[index + batch.length];
      if (!message) {
        throw new Error('run dispatch message is missing');
      }
      const messageBytes = jsonByteLength(message);
      if (messageBytes > MAX_QUEUE_MESSAGE_BYTES) {
        throw new Error('run dispatch message exceeds the queue size limit');
      }
      if (
        batch.length > 0 &&
        batchBytes + messageBytes > MAX_QUEUE_BATCH_BYTES
      ) {
        break;
      }
      batch.push(message);
      batchBytes += messageBytes;
    }
    await send(batch);
    index += batch.length;
    await markSent(index);
  }
};

const dispatchSelection = {
  id: runs.id,
  workspaceId: runs.workspaceId,
  totalCount: runs.totalCount,
  dispatchPlan: runs.dispatchPlan,
  dispatchState: runs.dispatchState,
  dispatchCursor: runs.dispatchCursor,
  dispatchAttempts: runs.dispatchAttempts,
  dispatchNextAttemptAt: runs.dispatchNextAttemptAt,
  dispatchStartedAt: runs.dispatchStartedAt,
};

type DispatchRow = {
  id: number;
  workspaceId: number;
  totalCount: number;
  dispatchPlan: RunDispatchPlan | null;
  dispatchState: RunDispatchState;
  dispatchCursor: number;
  dispatchAttempts: number;
  dispatchNextAttemptAt: number | null;
  dispatchStartedAt: number | null;
};

export interface RunDispatchResult {
  runId: number;
  state: RunDispatchState;
  cursor: number;
  attempts: number;
  expectedMessages: number | null;
  nextAttemptAt: number | null;
}

const dispatchResult = (row: DispatchRow): RunDispatchResult => {
  const parsed = runDispatchPlanSchema.safeParse(row.dispatchPlan);
  return {
    runId: row.id,
    state: row.dispatchState,
    cursor: row.dispatchCursor,
    attempts: row.dispatchAttempts,
    expectedMessages: parsed.success ? parsed.data.expectedMessages : null,
    nextAttemptAt: row.dispatchNextAttemptAt,
  };
};

const loadDispatchRow = async (
  db: Db,
  runId: number,
): Promise<DispatchRow | null> => {
  const row = (
    await db.select(dispatchSelection).from(runs).where(eq(runs.id, runId))
  )[0];
  return row ?? null;
};

const dispatchErrorMessage = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).slice(
    0,
    MAX_DISPATCH_ERROR_LENGTH,
  );

export const resumeRunDispatchWith = async (
  db: Db,
  queue: AppEnv['INGEST'],
  runId: number,
): Promise<RunDispatchResult | null> => {
  const now = Date.now();
  const leaseId = crypto.randomUUID();
  const claimed = (
    await db
      .update(runs)
      .set({
        dispatchState: 'dispatching',
        dispatchAttempts: sql`${runs.dispatchAttempts} + 1`,
        dispatchLastError: null,
        dispatchNextAttemptAt: null,
        dispatchLeaseId: leaseId,
        dispatchLeaseUntil: now + DISPATCH_LEASE_MS,
      })
      .where(
        and(
          eq(runs.id, runId),
          lt(runs.dispatchAttempts, MAX_DISPATCH_ATTEMPTS),
          or(
            and(
              eq(runs.dispatchState, 'pending'),
              or(
                isNull(runs.dispatchNextAttemptAt),
                lte(runs.dispatchNextAttemptAt, now),
              ),
            ),
            and(
              eq(runs.dispatchState, 'dispatching'),
              or(
                isNull(runs.dispatchLeaseUntil),
                lte(runs.dispatchLeaseUntil, now),
              ),
            ),
          ),
        ),
      )
      .returning(dispatchSelection)
  )[0];
  if (!claimed) {
    const existing = await loadDispatchRow(db, runId);
    return existing ? dispatchResult(existing) : null;
  }

  try {
    const parsed = runDispatchPlanSchema.safeParse(claimed.dispatchPlan);
    if (!parsed.success) {
      throw new Error(
        `invalid persisted dispatch plan: ${parsed.error.message}`,
      );
    }
    const plan = parsed.data;
    if (
      claimed.totalCount !==
      plan.prompts.length * plan.surfaces.length * plan.samples
    ) {
      throw new Error('dispatch plan does not match the run total');
    }
    const messages = messagesForRun(plan, claimed.id, claimed.workspaceId);
    if (messages.length !== plan.expectedMessages) {
      throw new Error(
        'dispatch plan reconstructed an unexpected message count',
      );
    }

    const started = await db
      .update(runs)
      .set({
        dispatchStartedAt: claimed.dispatchStartedAt ?? now,
        dispatchLeaseUntil: Date.now() + DISPATCH_LEASE_MS,
      })
      .where(
        and(
          eq(runs.id, claimed.id),
          eq(runs.dispatchState, 'dispatching'),
          eq(runs.dispatchLeaseId, leaseId),
        ),
      )
      .returning({ id: runs.id });
    if (started.length === 0) {
      throw new Error('run dispatch lease was lost before queue submission');
    }

    await dispatchMessageBatches(
      messages,
      claimed.dispatchCursor,
      async (batch) => {
        await queue.sendBatch(batch.map((body) => ({ body })));
      },
      async (nextCursor) => {
        const advanced = await db
          .update(runs)
          .set({
            dispatchCursor: nextCursor,
            dispatchLeaseUntil: Date.now() + DISPATCH_LEASE_MS,
          })
          .where(
            and(
              eq(runs.id, claimed.id),
              eq(runs.dispatchState, 'dispatching'),
              eq(runs.dispatchLeaseId, leaseId),
            ),
          )
          .returning({ id: runs.id });
        if (advanced.length === 0) {
          throw new Error('run dispatch lease was lost after queue submission');
        }
      },
    );

    const finished = (
      await db
        .update(runs)
        .set({
          dispatchState: 'dispatched',
          dispatchCursor: plan.expectedMessages,
          dispatchLastError: null,
          dispatchNextAttemptAt: null,
          dispatchFinishedAt: Date.now(),
          dispatchLeaseId: null,
          dispatchLeaseUntil: null,
        })
        .where(
          and(
            eq(runs.id, claimed.id),
            eq(runs.dispatchState, 'dispatching'),
            eq(runs.dispatchLeaseId, leaseId),
          ),
        )
        .returning(dispatchSelection)
    )[0];
    if (!finished) {
      const existing = await loadDispatchRow(db, runId);
      return existing ? dispatchResult(existing) : null;
    }
    return dispatchResult(finished);
  } catch (error) {
    const message = dispatchErrorMessage(error);
    const nextState =
      claimed.dispatchAttempts >= MAX_DISPATCH_ATTEMPTS
        ? 'exhausted'
        : 'pending';
    const retryDelay = Math.min(
      DISPATCH_RETRY_MAX_MS,
      DISPATCH_RETRY_BASE_MS * 2 ** (claimed.dispatchAttempts - 1),
    );
    await db
      .update(runs)
      .set({
        dispatchState: nextState,
        dispatchLastError: message,
        dispatchNextAttemptAt:
          nextState === 'pending' ? Date.now() + retryDelay : null,
        dispatchLeaseId: null,
        dispatchLeaseUntil: null,
      })
      .where(and(eq(runs.id, claimed.id), eq(runs.dispatchLeaseId, leaseId)));
    console.error(
      JSON.stringify({
        message: 'run dispatch failed',
        runId: claimed.id,
        attempt: claimed.dispatchAttempts,
        error: message,
      }),
    );
    const existing = await loadDispatchRow(db, runId);
    return existing ? dispatchResult(existing) : null;
  }
};

export const resumeRunDispatch = (env: AppEnv, runId: number) =>
  resumeRunDispatchWith(getDb(env), env.INGEST, runId);

export const resetAndResumeRunDispatchWith = async (
  db: Db,
  queue: AppEnv['INGEST'],
  runId: number,
): Promise<RunDispatchResult | null> => {
  const now = Date.now();
  await db
    .update(runs)
    .set({
      dispatchState: 'pending',
      dispatchAttempts: 0,
      dispatchLastError: null,
      dispatchNextAttemptAt: null,
      dispatchLeaseId: null,
      dispatchLeaseUntil: null,
    })
    .where(
      and(
        eq(runs.id, runId),
        or(
          eq(runs.dispatchState, 'pending'),
          eq(runs.dispatchState, 'exhausted'),
          and(
            eq(runs.dispatchState, 'dispatching'),
            or(
              isNull(runs.dispatchLeaseUntil),
              lte(runs.dispatchLeaseUntil, now),
            ),
          ),
        ),
      ),
    );
  return resumeRunDispatchWith(db, queue, runId);
};

export const resetAndResumeRunDispatch = (env: AppEnv, runId: number) =>
  resetAndResumeRunDispatchWith(getDb(env), env.INGEST, runId);

export const resumePendingRunDispatchesWith = async (
  db: Db,
  queue: AppEnv['INGEST'],
  options: { workspaceId?: number; limit?: number } = {},
): Promise<RunDispatchResult[]> => {
  const now = Date.now();
  await db
    .update(runs)
    .set({
      dispatchState: 'exhausted',
      dispatchLastError: 'dispatch attempt interrupted after retry limit',
      dispatchNextAttemptAt: null,
      dispatchLeaseId: null,
      dispatchLeaseUntil: null,
    })
    .where(
      and(
        eq(runs.dispatchState, 'dispatching'),
        gte(runs.dispatchAttempts, MAX_DISPATCH_ATTEMPTS),
        options.workspaceId === undefined
          ? undefined
          : eq(runs.workspaceId, options.workspaceId),
        or(isNull(runs.dispatchLeaseUntil), lte(runs.dispatchLeaseUntil, now)),
      ),
    );
  const pending = await db
    .select({ id: runs.id })
    .from(runs)
    .where(
      and(
        lt(runs.dispatchAttempts, MAX_DISPATCH_ATTEMPTS),
        options.workspaceId === undefined
          ? undefined
          : eq(runs.workspaceId, options.workspaceId),
        or(
          and(
            eq(runs.dispatchState, 'pending'),
            or(
              isNull(runs.dispatchNextAttemptAt),
              lte(runs.dispatchNextAttemptAt, now),
            ),
          ),
          and(
            eq(runs.dispatchState, 'dispatching'),
            or(
              isNull(runs.dispatchLeaseUntil),
              lte(runs.dispatchLeaseUntil, now),
            ),
          ),
        ),
      ),
    )
    .orderBy(runs.id)
    .limit(options.limit ?? DISPATCH_SWEEP_LIMIT);
  const resumed: RunDispatchResult[] = [];
  for (const row of pending) {
    const result = await resumeRunDispatchWith(db, queue, row.id);
    if (result) {
      resumed.push(result);
    }
  }
  return resumed;
};

export const resumePendingRunDispatches = (
  env: AppEnv,
  options: { workspaceId?: number; limit?: number } = {},
) => resumePendingRunDispatchesWith(getDb(env), env.INGEST, options);
