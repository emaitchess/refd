import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { WorkspaceBindings } from '../auth/middleware';
import { requireOperator } from '../auth/operator';
import { type Db, getDb } from '../db/client';
import {
  citations,
  entities,
  entityScores,
  prompts,
  results,
  runs,
  snapshots,
} from '../db/schema';
import type { IngestMessage } from '../ingest/messages';
import {
  answerTextFromRaw,
  rescoreProgress,
  rescoreStoredResult,
} from '../ingest/rescore';
import { createRun, entitiesForRun } from '../ingest/runs';
import { gunzipJson } from '../ingest/storage';
import { parseBody, parseId } from '../lib/http';
import type { DATASET_SURFACES } from '../providers/types';
import { SCORING_VERSION } from '../scoring';
import { loadEntitiesWithBrand } from './metrics';

const MANUAL_RUNS_PER_HOUR = 5;

// The run identified by id, scoped to the workspace — undefined if absent or foreign.
const getOwnedRun = async (db: Db, id: number, workspaceId: number) =>
  (
    await db
      .select()
      .from(runs)
      .where(and(eq(runs.id, id), eq(runs.workspaceId, workspaceId)))
  )[0];

export const runRoutes = new Hono<WorkspaceBindings>();

runRoutes.get('/', async (c) => {
  const db = getDb(c.env);
  const rows = await db
    .select()
    .from(runs)
    .where(eq(runs.workspaceId, c.get('workspace').id))
    .orderBy(desc(runs.id))
    .limit(100);
  return c.json({ runs: rows });
});

// Manual trigger spends provider quota. ADMIN_EMAILS is the server-side
// boundary; the rate limit is a second cost guard, not authorization.
const runOptionsSchema = z
  .object({
    promptIds: z.array(z.number().int().positive()).min(1).optional(),
    samples: z.number().int().min(1).max(10).optional(),
  })
  .nullable();

runRoutes.post('/', requireOperator, async (c) => {
  const opts = (await parseBody(c, runOptionsSchema)) ?? {};
  const db = getDb(c.env);
  const ws = c.get('workspace').id;
  const hourAgo = Date.now() - 60 * 60 * 1000;
  const recent = await db
    .select({ count: sql<number>`count(*)` })
    .from(runs)
    .where(
      and(
        eq(runs.trigger, 'manual'),
        gte(runs.createdAt, hourAgo),
        eq(runs.workspaceId, ws),
      ),
    );
  if ((recent[0]?.count ?? 0) >= MANUAL_RUNS_PER_HOUR) {
    return c.json({ error: 'manual run limit reached (5/hour)' }, 429);
  }

  const date = new Date().toISOString().slice(0, 10);
  const created = await createRun(
    c.env,
    ws,
    'manual',
    `manual:${crypto.randomUUID()}`,
    date,
    { promptIds: opts?.promptIds, samples: opts?.samples },
  );
  return c.json(created, 201);
});

// Recover paid provider data: re-enqueue the batch trigger for every dataset
// (surface, sample) of this run that has failed results and a stored
// snapshot. Zero provider spend — handleTrigger resumes the existing
// snapshot instead of buying a new one, ok results are check-then-skipped,
// and failed rows are overwritten by the real records. Internal operator
// lever, like rescore. Caveat: records echo the prompt text at trigger time,
// so a prompt edited since the run ran will not match and fails again.
runRoutes.post('/:id/recover', requireOperator, async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) {
    return c.json({ error: 'invalid id' }, 400);
  }
  const db = getDb(c.env);
  const ws = c.get('workspace').id;
  const run = await getOwnedRun(db, id, ws);
  if (!run) {
    return c.json({ error: 'not found' }, 404);
  }

  const rows = await db
    .select({
      promptId: results.promptId,
      surface: results.surface,
      sample: results.sample,
      ok: results.ok,
      provider: results.provider,
    })
    .from(results)
    .where(eq(results.runId, id));
  const failedCells = new Set(
    rows
      .filter((r) => !r.ok && r.provider === 'brightdata')
      .map((r) => `${r.surface}:${r.sample}`),
  );
  if (failedCells.size === 0) {
    return c.json({ enqueued: 0 });
  }
  const snaps = await db
    .select()
    .from(snapshots)
    .where(and(eq(snapshots.runId, id), eq(snapshots.provider, 'brightdata')));
  const texts = new Map(
    (
      await db
        .select({ id: prompts.id, text: prompts.text })
        .from(prompts)
        .where(eq(prompts.workspaceId, ws))
    ).map((p) => [p.id, p.text]),
  );
  const messages: IngestMessage[] = [];
  for (const snap of snaps) {
    if (!failedCells.has(`${snap.surface}:${snap.sample}`)) {
      continue;
    }
    const batchIds =
      snap.promptIds ??
      rows
        .filter((r) => r.surface === snap.surface && r.sample === snap.sample)
        .map((r) => r.promptId);
    const runPrompts = [...new Set(batchIds)].flatMap((pid) => {
      const text = texts.get(pid);
      return text ? [{ id: pid, text }] : [];
    });
    if (runPrompts.length === 0) {
      continue;
    }
    messages.push({
      kind: 'brightdata_trigger',
      runId: id,
      workspaceId: ws,
      surface: snap.surface as (typeof DATASET_SURFACES)[number],
      sample: snap.sample,
      chunk: snap.chunk,
      prompts: runPrompts,
    });
  }
  for (let i = 0; i < messages.length; i += 100) {
    await c.env.INGEST.sendBatch(
      messages.slice(i, i + 100).map((body) => ({ body })),
    );
  }
  return c.json({ enqueued: messages.length });
});

// Workspace-wide backfill: queue-driven rescore of every result whose scores
// predate SCORING_VERSION. Internal operator lever (dev-only UI for now, an
// admin surface later): no provider quota is spent, replays are idempotent,
// and a double trigger just runs two converging chains over a shrinking
// stale set.
runRoutes.get('/rescore', async (c) => {
  const db = getDb(c.env);
  const progress = await rescoreProgress(db, c.get('workspace').id);
  return c.json({ scoringVersion: SCORING_VERSION, ...progress });
});

runRoutes.post('/rescore', requireOperator, async (c) => {
  const db = getDb(c.env);
  const ws = c.get('workspace').id;
  const progress = await rescoreProgress(db, ws);
  if (progress.stale > 0) {
    await c.env.INGEST.send({
      kind: 'rescore_batch',
      workspaceId: ws,
      afterResultId: 0,
    });
  }
  return c.json({ started: progress.stale > 0, ...progress });
});

// Replay every stored raw through the current parser + scorer, rewriting
// scores and citations in place. No provider spend (R2 is the source), fully
// idempotent — this is the recovery lever after a parser or scoring fix.
// Sequential R2 gets: fine at current run sizes; the Layer 5 queue job takes
// over if runs outgrow the worker's subrequest budget.
runRoutes.post('/:id/rescore', requireOperator, async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) {
    return c.json({ error: 'invalid id' }, 400);
  }
  const db = getDb(c.env);
  const ws = c.get('workspace').id;
  const run = await getOwnedRun(db, id, ws);
  if (!run) {
    return c.json({ error: 'not found' }, 404);
  }

  const entitiesToScore = await entitiesForRun(c.env, id, ws);
  const rows = await db.select().from(results).where(eq(results.runId, id));
  let rescored = 0;
  const sentimentIds: number[] = [];
  for (const row of rows) {
    try {
      const stored = await rescoreStoredResult(c.env, db, row, entitiesToScore);
      if (stored) {
        rescored += 1;
        if (stored.hasMentions) {
          sentimentIds.push(stored.resultId);
        }
      }
    } catch (error) {
      console.error('rescore: raw replay failed', row.r2Key, error);
    }
  }
  // An explicit per-run rescore also re-drives sentiment classification: the
  // handler no-ops on results whose mentioned rows are all labeled (carry-over
  // preserved them), so only rows a previous pass left unclassified cost a
  // model call.
  for (let i = 0; i < sentimentIds.length; i += 100) {
    await c.env.INGEST.sendBatch(
      sentimentIds.slice(i, i + 100).map((resultId) => ({
        body: {
          kind: 'sentiment_score',
          workspaceId: ws,
          resultId,
        } satisfies IngestMessage,
      })),
    );
  }
  return c.json({ rescored, total: rows.length });
});

runRoutes.get('/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) {
    return c.json({ error: 'invalid id' }, 400);
  }
  const db = getDb(c.env);
  const ws = c.get('workspace').id;
  const run = await getOwnedRun(db, id, ws);
  if (!run) {
    return c.json({ error: 'not found' }, 404);
  }

  const { brand } = await loadEntitiesWithBrand(db, ws);

  const rows = await db
    .select({
      id: results.id,
      promptId: results.promptId,
      promptText: prompts.text,
      surface: results.surface,
      sample: results.sample,
      provider: results.provider,
      ok: results.ok,
      answerPresent: results.answerPresent,
      totalUrls: results.totalUrls,
      error: results.error,
      durationMs: results.durationMs,
      hasRaw: sql<number>`case when ${results.r2Key} is not null then 1 else 0 end`,
      brandMentioned: sql<number>`coalesce(${entityScores.mentioned}, 0)`,
      brandCited: sql<number>`coalesce(${entityScores.cited}, 0)`,
      brandSentiment: entityScores.sentiment,
    })
    .from(results)
    .innerJoin(prompts, eq(results.promptId, prompts.id))
    .leftJoin(
      entityScores,
      and(
        eq(entityScores.resultId, results.id),
        eq(entityScores.entityId, brand?.id ?? -1),
      ),
    )
    .where(eq(results.runId, id))
    .orderBy(prompts.id, results.surface, results.sample);

  return c.json({ run, results: rows });
});

// Full detail for the result side pane: scores, citations, and the answer
// text re-derived from the gzipped raw payload in R2.
runRoutes.get('/:id/results/:resultId', async (c) => {
  const runId = parseId(c.req.param('id'));
  const resultId = parseId(c.req.param('resultId'));
  if (runId === null || resultId === null) {
    return c.json({ error: 'invalid id' }, 400);
  }
  const db = getDb(c.env);
  const owned = await getOwnedRun(db, runId, c.get('workspace').id);
  if (!owned) {
    return c.json({ error: 'not found' }, 404);
  }
  const row = (
    await db
      .select({
        id: results.id,
        promptText: prompts.text,
        surface: results.surface,
        sample: results.sample,
        provider: results.provider,
        ok: results.ok,
        answerPresent: results.answerPresent,
        totalUrls: results.totalUrls,
        error: results.error,
        durationMs: results.durationMs,
        r2Key: results.r2Key,
        createdAt: results.createdAt,
      })
      .from(results)
      .innerJoin(prompts, eq(results.promptId, prompts.id))
      .where(and(eq(results.id, resultId), eq(results.runId, runId)))
  )[0];
  if (!row) {
    return c.json({ error: 'not found' }, 404);
  }

  const [scores, citedRows, { brand: paneBrand }] = await Promise.all([
    db
      .select({
        name: entities.name,
        // Drives the inline favicon on highlighted mentions in the pane.
        domains: entities.domains,
        // The client highlighter composes name + domains + aliases exactly
        // like the scorer, so highlights and badges agree.
        aliases: entities.aliases,
        isBrand: entities.isBrand,
        sortOrder: entities.sortOrder,
        mentioned: entityScores.mentioned,
        cited: entityScores.cited,
        position: entityScores.position,
        sentiment: entityScores.sentiment,
      })
      .from(entityScores)
      .innerJoin(entities, eq(entityScores.entityId, entities.id))
      .where(eq(entityScores.resultId, resultId))
      .orderBy(asc(entities.sortOrder)),
    db
      .select({
        url: citations.url,
        registrableDomain: citations.registrableDomain,
        entityId: citations.entityId,
      })
      .from(citations)
      .where(eq(citations.resultId, resultId)),
    loadEntitiesWithBrand(db, c.get('workspace').id),
  ]);
  // "Ours" is derived, not stored: brand's own citations first, then by
  // domain (unattributable last), then URL.
  const cited = citedRows
    .map((row) => ({
      url: row.url,
      domainKey: row.registrableDomain ?? '￿',
      isOurs: row.entityId !== null && row.entityId === paneBrand?.id,
    }))
    .sort(
      (a, b) =>
        Number(b.isOurs) - Number(a.isOurs) ||
        a.domainKey.localeCompare(b.domainKey) ||
        a.url.localeCompare(b.url),
    )
    .map(({ url, isOurs }) => ({ url, isOurs }));

  // No answer (valid AIO absence) means no text to show — the raw there is
  // the full SERP, which would walk into organic-results noise.
  let answerText: string | null = null;
  if (row.r2Key && row.answerPresent) {
    const object = await c.env.RAW.get(row.r2Key);
    if (object?.body) {
      try {
        answerText = answerTextFromRaw(
          row.provider,
          await gunzipJson(object.body),
        );
      } catch (error) {
        console.error('raw parse failed', row.r2Key, error);
      }
    }
  }

  const { r2Key, ...result } = row;
  return c.json({
    result: { ...result, hasRaw: r2Key !== null },
    scores,
    citations: cited,
    answerText,
  });
});

// Raw payload from R2, decompressed for the viewer (see the note below).
runRoutes.get('/:id/results/:resultId/raw', async (c) => {
  const runId = parseId(c.req.param('id'));
  const resultId = parseId(c.req.param('resultId'));
  if (runId === null || resultId === null) {
    return c.json({ error: 'invalid id' }, 400);
  }
  const db = getDb(c.env);
  const owned = await getOwnedRun(db, runId, c.get('workspace').id);
  if (!owned) {
    return c.json({ error: 'not found' }, 404);
  }
  const row = (
    await db
      .select({ r2Key: results.r2Key })
      .from(results)
      .where(and(eq(results.id, resultId), eq(results.runId, runId)))
  )[0];
  if (!row?.r2Key) {
    return c.json({ error: 'no raw payload' }, 404);
  }
  const object = await c.env.RAW.get(row.r2Key);
  if (!object) {
    return c.json({ error: 'raw payload missing from storage' }, 404);
  }
  // R2 holds this gzipped. Decompress here rather than passing the bytes through
  // with `Content-Encoding: gzip`: the runtime strips that header off an
  // automatic-encoding response but leaves the body compressed, so the browser
  // renders the gzip bytes as text. The wire is still compressed — the platform
  // negotiates that itself.
  return new Response(
    object.body.pipeThrough(new DecompressionStream('gzip')),
    {
      headers: {
        'Content-Type': 'application/json',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=3600',
      },
    },
  );
});
