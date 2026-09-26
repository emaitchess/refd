import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { entities, entityScores } from '../db/schema';
import type { AppEnv } from '../env';

export type EntityRow = typeof entities.$inferSelect;

export interface NewEntity {
  name: string;
  domains: string[];
  aliases: { value: string; caseSensitive?: boolean }[];
  isBrand: boolean;
}

export type CreateEntityResult =
  | { ok: true; entity: EntityRow }
  | { ok: false; reason: 'duplicate' };

// Names are unique per workspace (case-insensitive by index convention), so a
// clash check up front keeps the unique-index error from surfacing raw. The
// brand always sorts (and colors) first.
export const createEntity = async (
  env: AppEnv,
  workspaceId: number,
  input: NewEntity,
): Promise<CreateEntityResult> => {
  const db = getDb(env);
  const existing = await db
    .select({
      id: entities.id,
      name: entities.name,
      sortOrder: entities.sortOrder,
    })
    .from(entities)
    .where(eq(entities.workspaceId, workspaceId));
  if (existing.some((e) => e.name.toLowerCase() === input.name.toLowerCase())) {
    return { ok: false, reason: 'duplicate' };
  }
  const maxOrder = existing.reduce((max, e) => Math.max(max, e.sortOrder), -1);
  const inserted = await db
    .insert(entities)
    .values({
      workspaceId,
      name: input.name,
      domains: input.domains,
      aliases: input.aliases,
      isBrand: input.isBrand,
      sortOrder: input.isBrand ? 0 : maxOrder + 1,
    })
    .onConflictDoNothing({ target: [entities.workspaceId, entities.name] })
    .returning();
  if (!inserted[0]) {
    return { ok: false, reason: 'duplicate' };
  }
  return { ok: true, entity: inserted[0] };
};

export type RemoveEntityResult =
  | { ok: true; action: 'deleted'; id: number }
  | { ok: false; reason: 'not-found' }
  | { ok: false; reason: 'is-brand' }
  | { ok: false; reason: 'has-history' };

// Trend data keys off the entity id: a competitor with scored history cannot
// be deleted without destroying it, so removal is refuse-not-cascade (the
// dashboard shows the same refusal).
export const removeEntity = async (
  env: AppEnv,
  workspaceId: number,
  entityId: number,
): Promise<RemoveEntityResult> => {
  const db = getDb(env);
  const target = (
    await db
      .select()
      .from(entities)
      .where(
        and(eq(entities.id, entityId), eq(entities.workspaceId, workspaceId)),
      )
      .limit(1)
  )[0];
  if (!target) {
    return { ok: false, reason: 'not-found' };
  }
  if (target.isBrand) {
    return { ok: false, reason: 'is-brand' };
  }
  const used = await db
    .select({ id: entityScores.id })
    .from(entityScores)
    .where(eq(entityScores.entityId, entityId))
    .limit(1);
  if (used.length > 0) {
    return { ok: false, reason: 'has-history' };
  }
  const deleted = await db
    .delete(entities)
    .where(eq(entities.id, entityId))
    .returning({ id: entities.id });
  if (!deleted[0]) {
    return { ok: false, reason: 'not-found' };
  }
  return { ok: true, action: 'deleted', id: deleted[0].id };
};
