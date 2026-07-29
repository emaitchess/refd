import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { entityScores, results, snapshots } from '../db/schema';
import type { AppEnv } from '../env';
import { classifySentiments } from '../lib/llm';
import {
  checkProgress,
  fetchSnapshot,
  normalizeDatasetRecord,
  notifyEnabled,
  ProviderRetryableError,
  recordPrompt,
  triggerBatch,
} from '../providers/brightdata';
import { fetchAioAnswer } from '../providers/brightdata-serp';
import type { DatasetSurface } from '../providers/types';
import type { ScorableEntity } from '../scoring';
import {
  type IngestMessage,
  ingestMessageSchema,
  type RunPrompt,
} from './messages';
import {
  answerFromRaw,
  rescoreStoredResult,
  selectStaleBatch,
} from './rescore';
import { entitiesForRun } from './runs';
import {
  gunzipJson,
  hasOkResult,
  refreshRunStatus,
  storeFailedResult,
  storeScoredResult,
} from './storage';

const POLL_DELAY_SECONDS = 60;
const BACKSTOP_DELAY_SECONDS = 1500;
const MAX_POLLS = 60; // give a snapshot up to ~1h before declaring it lost

const backoffSeconds = (
  attempts: number,
  retryAfter: number | null,
): number => {
  if (retryAfter !== null) {
    return Math.min(retryAfter, 3600);
  }
  const base = 30 * 2 ** Math.max(0, attempts - 1);
  const jitter = Math.floor(Math.random() * 15);
  return Math.min(base + jitter, 3600);
};

export const failWholeSnapshot = async (
  env: AppEnv,
  runId: number,
  surface: DatasetSurface,
  sample: number,
  chunk: number,
  promptsInRun: RunPrompt[],
  error: string,
  polls: number | null = null,
): Promise<void> => {
  const db = getDb(env);
  const snapshotKey = and(
    eq(snapshots.runId, runId),
    eq(snapshots.provider, 'brightdata'),
    eq(snapshots.surface, surface),
    eq(snapshots.sample, sample),
    eq(snapshots.chunk, chunk),
  );
  const snap = (await db.select().from(snapshots).where(snapshotKey))[0];
  const now = Date.now();
  const durationMs = snap ? now - snap.createdAt : null;
  for (const prompt of promptsInRun) {
    await storeFailedResult(
      db,
      {
        runId,
        promptId: prompt.id,
        surface,
        sample,
        provider: 'brightdata',
      },
      error,
      { durationMs },
    );
  }
  await db
    .update(snapshots)
    .set({ status: 'failed', finishedAt: now, polls })
    .where(snapshotKey);
  await refreshRunStatus(db, runId);
};

const handleTrigger = async (
  env: AppEnv,
  msg: Extract<IngestMessage, { kind: 'brightdata_trigger' }>,
): Promise<void> => {
  const db = getDb(env);
  const existing = await db
    .select()
    .from(snapshots)
    .where(
      and(
        eq(snapshots.runId, msg.runId),
        eq(snapshots.provider, 'brightdata'),
        eq(snapshots.surface, msg.surface),
        eq(snapshots.sample, msg.sample),
        eq(snapshots.chunk, msg.chunk),
      ),
    );

  // Idempotency: a redelivered trigger never re-spends a batch — it resumes
  // polling the snapshot that already exists.
  const existingSnapshot = existing[0];
  let snapshotId = existingSnapshot?.externalId ?? null;
  if (!snapshotId) {
    snapshotId = await triggerBatch(
      env,
      msg.surface,
      msg.prompts.map((p) => p.text),
    );
    await db
      .insert(snapshots)
      .values({
        runId: msg.runId,
        provider: 'brightdata',
        surface: msg.surface,
        sample: msg.sample,
        chunk: msg.chunk,
        promptIds: msg.prompts.map((p) => p.id),
        promptSnapshot: msg.prompts,
        externalId: snapshotId,
      })
      .onConflictDoUpdate({
        target: [
          snapshots.runId,
          snapshots.provider,
          snapshots.surface,
          snapshots.sample,
          snapshots.chunk,
        ],
        set: {
          promptIds: msg.prompts.map((p) => p.id),
          promptSnapshot: msg.prompts,
          externalId: snapshotId,
        },
      });
  } else if (existingSnapshot && !existingSnapshot.promptSnapshot) {
    await db
      .update(snapshots)
      .set({
        promptIds: msg.prompts.map((p) => p.id),
        promptSnapshot: msg.prompts,
      })
      .where(eq(snapshots.id, existingSnapshot.id));
  }

  await env.INGEST.send(
    {
      kind: 'brightdata_poll',
      runId: msg.runId,
      workspaceId: msg.workspaceId,
      surface: msg.surface,
      sample: msg.sample,
      chunk: msg.chunk,
      snapshotId,
      prompts: msg.prompts,
      polls: 0,
    } satisfies IngestMessage,
    {
      delaySeconds: notifyEnabled(env)
        ? BACKSTOP_DELAY_SECONDS
        : POLL_DELAY_SECONDS,
    },
  );
};

type DatasetFetchMessage = Extract<
  IngestMessage,
  { kind: 'brightdata_poll' | 'brightdata_fetch' }
>;

type SnapshotRow = typeof snapshots.$inferSelect;

const snapshotKeyFor = (msg: DatasetFetchMessage) =>
  and(
    eq(snapshots.runId, msg.runId),
    eq(snapshots.provider, 'brightdata'),
    eq(snapshots.surface, msg.surface),
    eq(snapshots.sample, msg.sample),
    eq(snapshots.chunk, msg.chunk),
  );

const loadTriggeredSnapshot = async (
  env: AppEnv,
  msg: DatasetFetchMessage,
): Promise<SnapshotRow | null> => {
  const snap = (
    await getDb(env).select().from(snapshots).where(snapshotKeyFor(msg))
  )[0];
  if (snap?.status !== 'triggered' || snap.externalId !== msg.snapshotId) {
    return null;
  }
  return snap;
};

const fetchAndStore = async (
  env: AppEnv,
  msg: DatasetFetchMessage,
  snap: SnapshotRow,
): Promise<void> => {
  const db = getDb(env);
  const snapshotKey = and(
    snapshotKeyFor(msg),
    eq(snapshots.externalId, msg.snapshotId),
  );
  const entitiesToScore = await entitiesForRun(env, msg.runId, msg.workspaceId);
  console.log(
    `brightdata fetch: ${msg.kind === 'brightdata_fetch' ? 'webhook' : 'poll'} snapshot ${msg.snapshotId}`,
  );
  const records = await fetchSnapshot(env, msg.snapshotId);
  // Ready-but-empty is transport weirdness, not data — prompts were
  // submitted, so records must exist. Retry; a snapshot that stays empty
  // dead-letters once retries exhaust instead of failing prompts instantly.
  if (records.length === 0 && msg.prompts.length > 0) {
    throw new ProviderRetryableError(
      `snapshot ${msg.snapshotId} ready but returned 0 records`,
    );
  }

  // Records echo their input prompt; group then assign one per expected prompt.
  const byPrompt = new Map<string, Record<string, unknown>[]>();
  for (const record of records) {
    const prompt = recordPrompt(record);
    if (prompt !== null) {
      const bucket = byPrompt.get(prompt) ?? [];
      bucket.push(record);
      byPrompt.set(prompt, bucket);
    }
  }

  const sentimentIds: number[] = [];
  for (const prompt of msg.prompts) {
    const identity = {
      runId: msg.runId,
      promptId: prompt.id,
      surface: msg.surface,
      sample: msg.sample,
      provider: 'brightdata',
    } as const;
    if (await hasOkResult(db, identity)) {
      continue;
    }
    const record = byPrompt.get(prompt.text)?.shift();
    if (!record) {
      await storeFailedResult(db, identity, 'no record for prompt in snapshot');
      continue;
    }
    if (typeof record.error === 'string' && record.error.length > 0) {
      await storeFailedResult(
        db,
        identity,
        `provider record error: ${record.error}`,
      );
      continue;
    }
    // Per-prompt isolation: one bad record must not fail the whole snapshot.
    // Duration = snapshot trigger → this result stored (batch answers share
    // one provider round-trip).
    const durationMs = Date.now() - snap.createdAt;
    try {
      const stored = await storeScoredResult(
        env,
        db,
        identity,
        normalizeDatasetRecord(record),
        entitiesToScore,
        { durationMs },
      );
      if (stored.hasMentions) {
        sentimentIds.push(stored.resultId);
      }
    } catch (error) {
      console.error('store failure', msg.surface, prompt.id, error);
      await storeFailedResult(db, identity, String(error), { durationMs });
    }
  }

  // Queues sendBatch caps at 100 messages per call.
  for (let i = 0; i < sentimentIds.length; i += 100) {
    await env.INGEST.sendBatch(
      sentimentIds.slice(i, i + 100).map((resultId) => ({
        body: {
          kind: 'sentiment_score',
          workspaceId: msg.workspaceId,
          resultId,
        } satisfies IngestMessage,
      })),
    );
  }

  await db
    .update(snapshots)
    .set({
      status: 'ready',
      finishedAt: Date.now(),
      polls: msg.kind === 'brightdata_poll' ? msg.polls : snap.polls,
    })
    .where(snapshotKey);
  await refreshRunStatus(db, msg.runId);
};

const handlePoll = async (
  env: AppEnv,
  msg: Extract<IngestMessage, { kind: 'brightdata_poll' }>,
): Promise<void> => {
  const snap = await loadTriggeredSnapshot(env, msg);
  if (!snap) {
    return;
  }
  const progress = await checkProgress(env, msg.snapshotId);

  if (progress === 'running') {
    if (msg.polls >= MAX_POLLS) {
      await failWholeSnapshot(
        env,
        msg.runId,
        msg.surface,
        msg.sample,
        msg.chunk,
        msg.prompts,
        `snapshot ${msg.snapshotId} still running after ${MAX_POLLS} polls`,
        msg.polls,
      );
      return;
    }
    await env.INGEST.send(
      { ...msg, polls: msg.polls + 1 } satisfies IngestMessage,
      {
        delaySeconds: POLL_DELAY_SECONDS,
      },
    );
    return;
  }

  if (progress === 'failed') {
    await failWholeSnapshot(
      env,
      msg.runId,
      msg.surface,
      msg.sample,
      msg.chunk,
      msg.prompts,
      `snapshot ${msg.snapshotId} failed at provider`,
      msg.polls,
    );
    return;
  }

  await fetchAndStore(env, msg, snap);
};

const handleFetch = async (
  env: AppEnv,
  msg: Extract<IngestMessage, { kind: 'brightdata_fetch' }>,
): Promise<void> => {
  const snap = await loadTriggeredSnapshot(env, msg);
  if (!snap) {
    return;
  }
  await fetchAndStore(env, msg, snap);
};

const handleSerpFetch = async (
  env: AppEnv,
  msg: Extract<IngestMessage, { kind: 'serp_aio_fetch' }>,
): Promise<void> => {
  const db = getDb(env);
  const identity = {
    runId: msg.runId,
    promptId: msg.prompt.id,
    surface: 'google_aio',
    sample: msg.sample,
    provider: 'brightdata-serp',
  } as const;
  // Idempotency: a redelivered message never re-spends a SERP request.
  if (await hasOkResult(db, identity)) {
    return;
  }
  const started = Date.now();
  const answer = await fetchAioAnswer(env, msg.prompt.text);
  const entitiesToScore = await entitiesForRun(env, msg.runId, msg.workspaceId);
  const stored = await storeScoredResult(
    env,
    db,
    identity,
    answer,
    entitiesToScore,
    {
      durationMs: Date.now() - started,
    },
  );
  if (stored.hasMentions) {
    await env.INGEST.send({
      kind: 'sentiment_score',
      workspaceId: msg.workspaceId,
      resultId: stored.resultId,
    } satisfies IngestMessage);
  }
  await refreshRunStatus(db, msg.runId);
};

// Post-scoring enrichment, deliberately outside the deterministic scoring
// path (FEATURES.md: no LLM in scoring). Classifies how the stored answer
// portrays each mentioned entity and fills entity_scores.sentiment; every
// early return leaves rows null ("—" in the UI), never failed.
const handleSentiment = async (
  env: AppEnv,
  msg: Extract<IngestMessage, { kind: 'sentiment_score' }>,
): Promise<void> => {
  const db = getDb(env);
  const scoreRows = await db
    .select({
      entityId: entityScores.entityId,
      sentiment: entityScores.sentiment,
    })
    .from(entityScores)
    .where(
      and(
        eq(entityScores.resultId, msg.resultId),
        eq(entityScores.mentioned, true),
      ),
    );
  // Idempotency: a redelivery after success has nothing left to classify.
  const pending = new Set(
    scoreRows.filter((r) => r.sentiment === null).map((r) => r.entityId),
  );
  if (pending.size === 0) {
    return;
  }
  const result = (
    await db.select().from(results).where(eq(results.id, msg.resultId))
  )[0];
  if (!result?.r2Key) {
    return;
  }
  const object = await env.RAW.get(result.r2Key);
  if (!object?.body) {
    return;
  }
  const answer = answerFromRaw(
    result.provider,
    result.answerPresent,
    await gunzipJson(object.body),
  );
  if (!answer || answer.answerText.length === 0) {
    return;
  }
  const candidates = (
    await entitiesForRun(env, result.runId, msg.workspaceId)
  ).filter((e) => pending.has(e.id));
  if (candidates.length === 0) {
    return;
  }
  const verdicts = await classifySentiments(env, {
    answerText: answer.answerText,
    entities: candidates.map((e) => ({ id: e.id, name: e.name })),
  });
  if (verdicts === null) {
    // Unparseable model output is usually transient (truncation, formatting).
    // Retry via the queue; if it never parses, the dead-letter leaves null.
    throw new ProviderRetryableError('sentiment: unparseable model output');
  }
  for (const [entityId, sentiment] of verdicts) {
    await db
      .update(entityScores)
      .set({ sentiment })
      .where(
        and(
          eq(entityScores.resultId, msg.resultId),
          eq(entityScores.entityId, entityId),
        ),
      );
  }
};

// One cursor batch of a workspace backfill rescore (Layer 5). Sized against
// the worker subrequest budget: each result costs an R2 get + put and a
// handful of D1 statements. A full batch re-enqueues the next cursor, so one
// trigger chains through the whole backlog; a short batch means the stale set
// is drained. Per-result failures log and keep their old scores (still stale,
// picked up by a future trigger) rather than wedging the chain.
const RESCORE_BATCH_SIZE = 10;

const handleRescoreBatch = async (
  env: AppEnv,
  msg: Extract<IngestMessage, { kind: 'rescore_batch' }>,
): Promise<void> => {
  const db = getDb(env);
  const batch = await selectStaleBatch(
    db,
    msg.workspaceId,
    msg.afterResultId,
    RESCORE_BATCH_SIZE,
  );
  const entitiesByRun = new Map<number, ScorableEntity[]>();
  for (const row of batch) {
    let toScore = entitiesByRun.get(row.runId);
    if (!toScore) {
      toScore = await entitiesForRun(env, row.runId, msg.workspaceId);
      entitiesByRun.set(row.runId, toScore);
    }
    try {
      await rescoreStoredResult(env, db, row, toScore);
    } catch (error) {
      console.error(
        'rescore: result failed, keeping old scores',
        row.id,
        error,
      );
    }
  }
  const last = batch[batch.length - 1];
  if (batch.length === RESCORE_BATCH_SIZE && last) {
    await env.INGEST.send({
      kind: 'rescore_batch',
      workspaceId: msg.workspaceId,
      afterResultId: last.id,
    });
  }
};

const markMessageFailed = async (
  env: AppEnv,
  msg: IngestMessage,
  error: string,
): Promise<void> => {
  if (msg.kind === 'rescore_batch' || msg.kind === 'sentiment_score') {
    // Enrichment work has nothing to mark failed: a dead-lettered rescore
    // batch leaves its results stale (the next trigger resumes from the same
    // cursor); a dead-lettered sentiment message leaves sentiment null.
    console.error('enrichment message dead-lettered', msg.kind, error);
    return;
  }
  if (msg.kind === 'serp_aio_fetch') {
    const db = getDb(env);
    await storeFailedResult(
      db,
      {
        runId: msg.runId,
        promptId: msg.prompt.id,
        surface: 'google_aio',
        sample: msg.sample,
        provider: 'brightdata-serp',
      },
      error,
    );
    await refreshRunStatus(db, msg.runId);
    return;
  }
  await failWholeSnapshot(
    env,
    msg.runId,
    msg.surface,
    msg.sample,
    msg.chunk,
    msg.prompts,
    error,
    'polls' in msg ? msg.polls : null,
  );
};

export const handleIngestBatch = async (
  batch: MessageBatch<IngestMessage>,
  env: AppEnv,
): Promise<void> => {
  // Dead-letter queue: retries exhausted — record the failure so the run can
  // still complete, then ack.
  if (batch.queue.endsWith('-dlq')) {
    for (const message of batch.messages) {
      const parsed = ingestMessageSchema.safeParse(message.body);
      if (parsed.success) {
        await markMessageFailed(
          env,
          parsed.data,
          'retries exhausted (dead-letter)',
        );
      }
      message.ack();
    }
    return;
  }

  for (const message of batch.messages) {
    const parsed = ingestMessageSchema.safeParse(message.body);
    if (!parsed.success) {
      // Malformed — e.g. enqueued before a deploy changed the shape. Never retry
      // a permanently-bad message; ack to drop it rather than loop to the DLQ.
      console.error('ingest: dropping malformed message', parsed.error.issues);
      message.ack();
      continue;
    }
    const body = parsed.data;
    try {
      if (body.kind === 'brightdata_trigger') {
        await handleTrigger(env, body);
      } else if (body.kind === 'brightdata_poll') {
        await handlePoll(env, body);
      } else if (body.kind === 'brightdata_fetch') {
        await handleFetch(env, body);
      } else if (body.kind === 'serp_aio_fetch') {
        await handleSerpFetch(env, body);
      } else if (body.kind === 'sentiment_score') {
        await handleSentiment(env, body);
      } else {
        await handleRescoreBatch(env, body);
      }
      message.ack();
    } catch (error) {
      // Enrichment messages (rescore, sentiment) have no provider identity to
      // fail: their errors are R2/D1/Workers-AI hiccups and the work is
      // idempotent, so retrying is always right.
      if (
        error instanceof ProviderRetryableError ||
        body.kind === 'rescore_batch' ||
        body.kind === 'sentiment_score'
      ) {
        // Rate-limited or transient: honor Retry-After, else backoff+jitter.
        message.retry({
          delaySeconds: backoffSeconds(
            message.attempts,
            error instanceof ProviderRetryableError
              ? error.retryAfterSeconds
              : null,
          ),
        });
        continue;
      }
      // Non-retryable: record the failure and move on.
      console.error('ingest failure', body.kind, error);
      await markMessageFailed(env, body, String(error));
      message.ack();
    }
  }
};
