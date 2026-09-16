import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client';
import {
  citations,
  entityScores,
  results,
  runs,
  users,
  workspaces,
} from '../db/schema';
import type { AppEnv } from '../env';
import type { NormalizedAnswer, Surface } from '../providers/types';
import { type ScorableEntity, scoreResult } from '../scoring';
import { cleanRawObject, clearRawCleanup, registerRawWrite } from './deletion';

export const rawKey = (
  runId: number,
  promptId: number,
  surface: Surface,
  sample: number,
) => `raw/${runId}/${promptId}-${surface}-${sample}.json.gz`;

export const gzipJson = async (value: unknown): Promise<ArrayBuffer> => {
  const stream = new Blob([JSON.stringify(value)])
    .stream()
    .pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
};

// Inverse of gzipJson: decode a gzipped R2 body back to its JSON value.
export const gunzipJson = async (body: ReadableStream): Promise<unknown> => {
  const stream = body.pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
};

export interface ResultIdentity {
  runId: number;
  promptId: number;
  surface: Surface;
  sample: number;
  provider: string;
}

export class IngestFencedError extends Error {}
export class IngestCleanupError extends Error {}

export const runAcceptsIngest = async (
  db: Db,
  runId: number,
): Promise<boolean> => {
  const row = (
    await db
      .select({ id: runs.id })
      .from(runs)
      .innerJoin(workspaces, eq(runs.workspaceId, workspaces.id))
      .innerJoin(users, eq(workspaces.ownerUserId, users.id))
      .where(
        and(
          eq(runs.id, runId),
          isNull(workspaces.deletingAt),
          isNull(users.deletingAt),
        ),
      )
      .limit(1)
  )[0];
  return row !== undefined;
};

// Idempotency guard: has this unit of work already succeeded?
export const hasOkResult = async (
  db: Db,
  id: ResultIdentity,
): Promise<boolean> => {
  const existing = await db
    .select({ ok: results.ok })
    .from(results)
    .where(
      and(
        eq(results.runId, id.runId),
        eq(results.promptId, id.promptId),
        eq(results.surface, id.surface),
        eq(results.sample, id.sample),
      ),
    );
  return existing[0]?.ok === true;
};

const upsertResult = async (
  db: Db,
  id: ResultIdentity,
  values: {
    ok: boolean;
    answerPresent: boolean;
    r2Key: string | null;
    totalUrls: number;
    error: string | null;
    durationMs: number | null;
  },
): Promise<number> => {
  const row = await db
    .insert(results)
    .values({ ...id, ...values })
    .onConflictDoUpdate({
      target: [
        results.runId,
        results.promptId,
        results.surface,
        results.sample,
      ],
      set: { ...values, provider: id.provider },
    })
    .returning({ id: results.id });
  const resultId = row[0]?.id;
  if (resultId === undefined) {
    throw new Error('result upsert returned no id');
  }
  return resultId;
};

// D1 caps bound parameters per statement (~100) — a citation-heavy answer
// (ChatGPT with web search returns 50+ URLs) must insert in chunks.
const insertChunked = async <T>(
  rows: T[],
  chunkSize: number,
  insert: (chunk: T[]) => Promise<unknown>,
): Promise<void> => {
  for (let i = 0; i < rows.length; i += chunkSize) {
    await insert(rows.slice(i, i + chunkSize));
  }
};

export const storeScoredResult = async (
  env: AppEnv,
  db: Db,
  id: ResultIdentity,
  answer: NormalizedAnswer,
  entitiesToScore: ScorableEntity[],
  opts: { durationMs?: number | null; writeRaw?: boolean } = {},
): Promise<{ resultId: number; hasMentions: boolean }> => {
  const key = rawKey(id.runId, id.promptId, id.surface, id.sample);
  const writeRaw = opts.writeRaw !== false;
  if (!(await runAcceptsIngest(db, id.runId))) {
    throw new IngestFencedError('workspace is being deleted');
  }
  const rawWriteToken = writeRaw ? await registerRawWrite(env, key) : null;
  if (rawWriteToken) {
    // Deterministic key: a retry overwrites the same object, never duplicates.
    await env.RAW.put(key, await gzipJson(answer.raw), {
      httpMetadata: {
        contentType: 'application/json',
        contentEncoding: 'gzip',
      },
    });
  }

  try {
    if (!(await runAcceptsIngest(db, id.runId))) {
      if (rawWriteToken) {
        await cleanRawObject(env, key, rawWriteToken);
      }
      throw new IngestFencedError('workspace is being deleted');
    }

    // A present answer with no text is provider field drift, not a quiet
    // zero: stored as ok it would count as a non-mention in every scoreable
    // denominator and silently deflate the rates. Fail the prompt instead;
    // the raw is already stashed at the key above for diagnosis.
    if (answer.answerPresent && answer.answerText.trim().length === 0) {
      throw new Error('answerPresent with empty answer text (provider drift?)');
    }

    const scored = scoreResult(answer, entitiesToScore);
    // ok stays false until every child row landed: a crash mid-insert leaves a
    // row that reads as incomplete (retry redoes it), never as a success.
    const resultId = await upsertResult(db, id, {
      ok: false,
      answerPresent: answer.answerPresent,
      r2Key: key,
      totalUrls: scored.totalUrls,
      error: null,
      durationMs: opts.durationMs ?? null,
    });

    // Delete-then-insert so a retry after partial failure converges. Chunk
    // sizes track the widened v2 rows against D1's ~100-bound-params cap:
    // entity_scores 11 columns, citations 8.
    await db.delete(entityScores).where(eq(entityScores.resultId, resultId));
    await db.delete(citations).where(eq(citations.resultId, resultId));
    await insertChunked(scored.scores, 8, (chunk) =>
      db.insert(entityScores).values(chunk.map((s) => ({ resultId, ...s }))),
    );
    await insertChunked(scored.citations, 7, (chunk) =>
      db.insert(citations).values(chunk.map((c) => ({ resultId, ...c }))),
    );
    await db
      .update(results)
      .set({ ok: true, error: null })
      .where(eq(results.id, resultId));
    if (rawWriteToken) {
      await clearRawCleanup(env, key, rawWriteToken);
    }
    // hasMentions gates the sentiment enqueue — an answer that mentions no
    // tracked entity has nothing to classify.
    return { resultId, hasMentions: scored.scores.some((s) => s.mentioned) };
  } catch (error) {
    if (
      rawWriteToken &&
      !(await runAcceptsIngest(db, id.runId).catch(() => false))
    ) {
      try {
        await cleanRawObject(env, key, rawWriteToken);
      } catch {
        throw new IngestCleanupError(key);
      }
    }
    throw error;
  }
};

export const storeFailedResult = async (
  db: Db,
  id: ResultIdentity,
  error: string,
  opts: { durationMs?: number | null } = {},
): Promise<void> => {
  // Never clobber a success with a late-arriving failure.
  if (await hasOkResult(db, id)) {
    return;
  }
  await upsertResult(db, id, {
    ok: false,
    answerPresent: false,
    r2Key: null,
    totalUrls: 0,
    error: error.slice(0, 500),
    durationMs: opts.durationMs ?? null,
  });
};

// Recompute run counters; mark complete once every expected result landed.
export const refreshRunStatus = async (
  db: Db,
  runId: number,
): Promise<void> => {
  const run = await db.select().from(runs).where(eq(runs.id, runId));
  const current = run[0];
  if (current?.status !== 'running') {
    return;
  }
  const rows = await db
    .select({ ok: results.ok })
    .from(results)
    .where(eq(results.runId, runId));
  const okCount = rows.filter((r) => r.ok).length;
  const done = rows.length >= current.totalCount;
  await db
    .update(runs)
    .set({
      okCount,
      ...(done
        ? {
            status: okCount > 0 ? ('complete' as const) : ('failed' as const),
            completedAt: Date.now(),
          }
        : {}),
    })
    .where(eq(runs.id, runId));
};
