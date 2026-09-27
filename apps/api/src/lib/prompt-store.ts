import type { Limit } from '@refd/core/config';
import {
  classifyPromptCohort,
  type PromptKind,
} from '@refd/core/prompt-cohorts';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type Db, getDb } from '../db/client';
import { entities, prompts, results, runs } from '../db/schema';
import type { AppEnv } from '../env';
import { resolveAttributeId } from './attributes';
import { insertActivePrompt } from './prompt-limit';

export type PromptRow = typeof prompts.$inferSelect;

const insertedPromptSchema = z.object({ id: z.number().int().positive() });

const loadPrompt = async (
  db: Db,
  promptId: number,
  workspaceId: number,
): Promise<PromptRow | undefined> =>
  (
    await db
      .select()
      .from(prompts)
      .where(
        and(eq(prompts.id, promptId), eq(prompts.workspaceId, workspaceId)),
      )
      .limit(1)
  )[0];

// The workspace text is the prompt's identity (unique per workspace): one
// shared duplicate pre-check keeps a raw unique-index error from surfacing.
const textClash = async (
  db: Db,
  workspaceId: number,
  text: string,
  exceptPromptId: number,
): Promise<boolean> => {
  const clash = await db
    .select({ id: prompts.id })
    .from(prompts)
    .where(and(eq(prompts.workspaceId, workspaceId), eq(prompts.text, text)));
  return clash.some((row) => row.id !== exceptPromptId);
};

export interface PromptPatch {
  text?: string;
  tags?: string[];
  kind?: PromptKind;
  attributeId?: number | null;
  // Never true here: an activation must go through setPromptActive's bound.
  active?: false;
}

export type CreatePromptResult =
  | { ok: true; prompt: PromptRow; duplicated: boolean }
  | { ok: false; reason: 'limit'; limit: number };

const classifyPromptText = async (
  db: Db,
  workspaceId: number,
  text: string,
): Promise<PromptKind | null> => {
  const tracked = await db
    .select({
      id: entities.id,
      name: entities.name,
      domains: entities.domains,
      aliases: entities.aliases,
      isBrand: entities.isBrand,
    })
    .from(entities)
    .where(eq(entities.workspaceId, workspaceId));
  // A workspace with no entities yet has nothing to classify against, so the
  // prompt stays unclassified rather than being asserted into a cohort.
  return tracked.length === 0 ? null : classifyPromptCohort(text, tracked);
};

// Atomic create honoring the workspace's active-prompt ceiling. A same-text
// row (active or retired) resolves to the existing prompt, which makes a
// retried create converge instead of erroring twice.
//
// An omitted kind is classified here, where the entity set is reachable, so a
// prompt is born in its cohort rather than waiting for a cohort-aware read.
export const createPrompt = async (
  env: AppEnv,
  workspaceId: number,
  text: string,
  tags: string[],
  limit: Limit,
  kind?: PromptKind | null,
  attribute?: string,
): Promise<CreatePromptResult> => {
  const db = getDb(env);
  // The attribute is resolved first so a bad label is refused before the row
  // exists, and the insert itself stays the single bounded statement the ceiling
  // check depends on.
  const attributeId = await resolveAttributeId(db, workspaceId, attribute);
  const insertedId = await insertActivePrompt(
    env,
    workspaceId,
    text,
    tags,
    limit,
    kind === undefined ? await classifyPromptText(db, workspaceId, text) : kind,
  );
  // undefined means the caller said nothing about grouping, which is not the
  // same as asking for no attribute: only a resolved id writes the column.
  if (
    insertedId !== null &&
    attributeId !== null &&
    attributeId !== undefined
  ) {
    await db
      .update(prompts)
      .set({ attributeId })
      .where(eq(prompts.id, insertedId));
  }
  if (insertedId !== null) {
    const prompt = await loadPrompt(db, insertedId, workspaceId);
    if (!prompt) {
      throw new Error('inserted prompt not found');
    }
    return { ok: true, prompt, duplicated: false };
  }
  const duplicate = (
    await db
      .select()
      .from(prompts)
      .where(and(eq(prompts.workspaceId, workspaceId), eq(prompts.text, text)))
      .limit(1)
  )[0];
  if (duplicate) {
    return { ok: true, prompt: duplicate, duplicated: true };
  }
  if (limit === null) {
    throw new Error('unlimited prompt insert returned no row');
  }
  return { ok: false, reason: 'limit', limit };
};

export type UpdatePromptResult =
  | { ok: true; prompt: PromptRow }
  | { ok: false; reason: 'not-found' }
  | { ok: false; reason: 'duplicate' };

// Field edit that never changes the active count, so no ceiling check: a
// prompt's text or tags can move regardless of how full the workspace is.
export const updatePromptFields = async (
  env: AppEnv,
  promptId: number,
  workspaceId: number,
  patch: PromptPatch,
): Promise<UpdatePromptResult> => {
  const db = getDb(env);
  if (
    patch.text !== undefined &&
    (await textClash(db, workspaceId, patch.text, promptId))
  ) {
    return { ok: false, reason: 'duplicate' };
  }
  const updated = await db
    .update(prompts)
    .set(patch)
    .where(and(eq(prompts.id, promptId), eq(prompts.workspaceId, workspaceId)))
    .returning();
  if (!updated[0]) {
    return { ok: false, reason: 'not-found' };
  }
  return { ok: true, prompt: updated[0] };
};

export type SetPromptActiveResult =
  | { ok: true; prompt: PromptRow }
  | { ok: false; reason: 'not-found' }
  | { ok: false; reason: 'duplicate' }
  | { ok: false; reason: 'limit'; limit: number };

// Activation is bounded by the same atomic count the dashboard uses; a
// deactivation is a plain flip. Optional field edits ride along atomically
// (the dashboard's retext-and-reactivate path).
export const setPromptActive = async (
  env: AppEnv,
  promptId: number,
  workspaceId: number,
  active: boolean,
  limit: Limit,
  patch: Omit<PromptPatch, 'active'> = {},
): Promise<SetPromptActiveResult> => {
  if (!active) {
    const result = await updatePromptFields(env, promptId, workspaceId, {
      ...patch,
      active: false,
    });
    return result.ok ? result : { ok: false, reason: result.reason };
  }
  const db = getDb(env);
  if (
    patch.text !== undefined &&
    (await textClash(db, workspaceId, patch.text, promptId))
  ) {
    return { ok: false, reason: 'not-found' };
  }
  const assignments: string[] = [];
  const values: unknown[] = [];
  if (patch.text !== undefined) {
    assignments.push('text = ?');
    values.push(patch.text);
  }
  if (patch.tags !== undefined) {
    assignments.push('tags = ?');
    values.push(JSON.stringify(patch.tags));
  }
  if (patch.kind !== undefined) {
    assignments.push('kind = ?');
    values.push(patch.kind);
  }
  if (patch.attributeId !== undefined) {
    assignments.push('attribute_id = ?');
    values.push(patch.attributeId);
  }
  assignments.push('active = 1');
  const row = await env.DB.prepare(
    `update prompts
     set ${assignments.join(', ')}
     where id = ? and workspace_id = ?
       and (
         active = 1 or ? is null or (
           select count(*) from prompts
           where workspace_id = ? and active = 1
         ) < ?
       )
     returning id`,
  )
    .bind(...values, promptId, workspaceId, limit, workspaceId, limit)
    .first();
  if (row === null) {
    const owned = await loadPrompt(db, promptId, workspaceId);
    if (!owned) {
      return { ok: false, reason: 'not-found' };
    }
    if (limit === null) {
      throw new Error('unlimited prompt activation returned no row');
    }
    return { ok: false, reason: 'limit', limit };
  }
  const activated = insertedPromptSchema.safeParse(row);
  if (!activated.success) {
    throw new Error('prompt activation returned an invalid row');
  }
  const prompt = await loadPrompt(db, activated.data.id, workspaceId);
  if (!prompt) {
    throw new Error('activated prompt not found');
  }
  return { ok: true, prompt };
};

export type RemovePromptResult =
  | { ok: true; action: 'deleted'; id: number }
  | { ok: true; action: 'retired'; prompt: PromptRow }
  | { ok: false; reason: 'not-found' }
  | { ok: false; reason: 'has-results' };

// History owns a used prompt: results and scores key off its id, so removal
// retires it (active=false, no active slot consumed). An unused prompt has no
// history to lose and is deleted outright.
export const removePrompt = async (
  env: AppEnv,
  promptId: number,
  workspaceId: number,
  { retireWhenUsed }: { retireWhenUsed: boolean },
): Promise<RemovePromptResult> => {
  const db = getDb(env);
  const owned = await loadPrompt(db, promptId, workspaceId);
  if (!owned) {
    return { ok: false, reason: 'not-found' };
  }
  const used = await db
    .select({ id: results.id })
    .from(results)
    .where(eq(results.promptId, promptId))
    .limit(1);
  if (used.length > 0) {
    if (!retireWhenUsed) {
      return { ok: false, reason: 'has-results' };
    }
    const updated = await db
      .update(prompts)
      .set({ active: false })
      .where(
        and(eq(prompts.id, promptId), eq(prompts.workspaceId, workspaceId)),
      )
      .returning();
    if (!updated[0]) {
      return { ok: false, reason: 'not-found' };
    }
    return { ok: true, action: 'retired', prompt: updated[0] };
  }
  const deleted = await db
    .delete(prompts)
    .where(and(eq(prompts.id, promptId), eq(prompts.workspaceId, workspaceId)))
    .returning({ id: prompts.id });
  if (!deleted[0]) {
    return { ok: false, reason: 'not-found' };
  }
  return { ok: true, action: 'deleted', id: deleted[0].id };
};

// Per-prompt answer counts for management views: which prompts carry history
// (and therefore retire instead of delete). One grouped scan, workspace-scoped.
export const promptUsageCounts = async (
  env: AppEnv,
  workspaceId: number,
): Promise<Map<number, number>> => {
  const rows = await getDb(env)
    .select({
      promptId: results.promptId,
      answers: sql<number>`count(*)`,
    })
    .from(results)
    .innerJoin(runs, eq(results.runId, runs.id))
    .where(eq(runs.workspaceId, workspaceId))
    .groupBy(results.promptId);
  return new Map(rows.map((row) => [row.promptId, row.answers]));
};
