import { and, asc, eq, gt, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { entityScores, results, runs } from '../db/schema';
import type { AppEnv } from '../env';
import { normalizeDatasetRecord } from '../providers/brightdata';
import { parseAioNode } from '../providers/brightdata-serp';
import type { NormalizedAnswer, Surface } from '../providers/types';
import {
  collectStringsAndUrls,
  SCORING_VERSION,
  type ScorableEntity,
} from '../scoring';
import { gunzipJson, storeScoredResult } from './storage';

// Re-derive the readable answer text from the stored raw payload (display,
// not scoring: prefers the markdown field).
export const answerTextFromRaw = (
  provider: string,
  raw: unknown,
): string | null => {
  if (provider === 'brightdata' && typeof raw === 'object' && raw !== null) {
    const record = raw as Record<string, unknown>;
    const markdown = record.answer_text_markdown;
    if (typeof markdown === 'string' && markdown.trim().length > 0) {
      return markdown;
    }
    const text = normalizeDatasetRecord(record).answerText;
    return text.length > 0 ? text : null;
  }
  if (provider === 'brightdata-serp') {
    // Same structured parse the scorer uses — the reader must see the exact
    // text the mention spans were computed against, not a raw walk.
    const text = parseAioNode(raw).answerText;
    return text.length > 0 ? text : null;
  }
  const texts: string[] = [];
  collectStringsAndUrls(raw, texts, []);
  return texts.length > 0 ? texts.join('\n') : null;
};

// Rebuild an answer from its stored raw, per provider. Unknown providers
// return null — their raw shape is unscorable (e.g. legacy imports).
export const answerFromRaw = (
  provider: string,
  answerPresent: boolean,
  raw: unknown,
): NormalizedAnswer | null => {
  if (provider === 'brightdata' && typeof raw === 'object' && raw !== null) {
    return normalizeDatasetRecord(raw as Record<string, unknown>);
  }
  if (provider === 'brightdata-serp') {
    // For an absent AIO the raw is the full SERP — never parse it as an answer.
    return answerPresent
      ? { ...parseAioNode(raw), answerPresent: true, raw }
      : { answerText: '', sourceUrls: [], answerPresent: false, raw };
  }
  return null;
};

export interface RescorableRow {
  id: number;
  runId: number;
  promptId: number;
  surface: string;
  sample: number;
  provider: string;
  answerPresent: boolean;
  r2Key: string | null;
  durationMs: number | null;
}

// Replay one stored raw through the current parser + scorer, overwriting the
// derived rows in place. Null = nothing to replay (no raw, unscorable
// provider). Duration is preserved: a rescore is not a new fetch.
export const rescoreStoredResult = async (
  env: AppEnv,
  db: Db,
  row: RescorableRow,
  entitiesToScore: ScorableEntity[],
): Promise<{ resultId: number; hasMentions: boolean } | null> => {
  if (!row.r2Key) {
    return null;
  }
  const object = await env.RAW.get(row.r2Key);
  if (!object?.body) {
    return null;
  }
  const raw = await gunzipJson(object.body);
  const answer = answerFromRaw(row.provider, row.answerPresent, raw);
  if (!answer) {
    return null;
  }
  // Sentiment survives a rescore: the raw is unchanged, so the classification
  // still applies, and classification is only ever triggered by fresh
  // fetches. Captured before storeScoredResult rewrites the score rows.
  const priorSentiments = await db
    .select({
      entityId: entityScores.entityId,
      sentiment: entityScores.sentiment,
    })
    .from(entityScores)
    .where(
      and(eq(entityScores.resultId, row.id), isNotNull(entityScores.sentiment)),
    );
  const stored = await storeScoredResult(
    env,
    db,
    {
      runId: row.runId,
      promptId: row.promptId,
      surface: row.surface as Surface,
      sample: row.sample,
      provider: row.provider,
    },
    answer,
    entitiesToScore,
    { durationMs: row.durationMs },
  );
  for (const prior of priorSentiments) {
    if (prior.sentiment === null) {
      continue;
    }
    // Filtered on mentioned: an entity the current scorer no longer counts
    // as mentioned must not keep a stale label.
    await db
      .update(entityScores)
      .set({ sentiment: prior.sentiment })
      .where(
        and(
          eq(entityScores.resultId, row.id),
          eq(entityScores.entityId, prior.entityId),
          eq(entityScores.mentioned, true),
        ),
      );
  }
  return stored;
};

// A result is stale when any of its scores predate the current scorer.
// Results with raws but zero entity_scores rows (scored under an empty
// entity set) have nothing to lift and are deliberately never selected.
const staleExists = sql`exists (select 1 from ${entityScores}
  where ${entityScores.resultId} = ${results.id}
  and ${entityScores.scoringVersion} < ${SCORING_VERSION})`;

export const selectStaleBatch = async (
  db: Db,
  workspaceId: number,
  afterResultId: number,
  limit: number,
): Promise<RescorableRow[]> =>
  db
    .select({
      id: results.id,
      runId: results.runId,
      promptId: results.promptId,
      surface: results.surface,
      sample: results.sample,
      provider: results.provider,
      answerPresent: results.answerPresent,
      r2Key: results.r2Key,
      durationMs: results.durationMs,
    })
    .from(results)
    .innerJoin(runs, eq(runs.id, results.runId))
    .where(
      and(
        eq(runs.workspaceId, workspaceId),
        gt(results.id, afterResultId),
        isNotNull(results.r2Key),
        staleExists,
      ),
    )
    .orderBy(asc(results.id))
    .limit(limit);

export const rescoreProgress = async (
  db: Db,
  workspaceId: number,
): Promise<{ total: number; stale: number }> => {
  const row = (
    await db
      .select({
        total: sql<number>`count(*)`,
        stale: sql<number>`coalesce(sum(case when ${staleExists} then 1 else 0 end), 0)`,
      })
      .from(results)
      .innerJoin(runs, eq(runs.id, results.runId))
      .where(and(eq(runs.workspaceId, workspaceId), isNotNull(results.r2Key)))
  )[0];
  return { total: row?.total ?? 0, stale: row?.stale ?? 0 };
};
