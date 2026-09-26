import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { WorkspaceBindings } from '../auth/middleware';
import { getDb } from '../db/client';
import { entities } from '../db/schema';
import { createEntity, removeEntity } from '../lib/entity-store';
import { parseBody, parseId } from '../lib/http';
import { domainField, singleLineText } from '../lib/sanitize';

export const entityRoutes = new Hono<WorkspaceBindings>();

entityRoutes.get('/', async (c) => {
  const db = getDb(c.env);
  return c.json({
    entities: await db
      .select()
      .from(entities)
      .where(eq(entities.workspaceId, c.get('workspace').id))
      .orderBy(entities.sortOrder),
  });
});

const aliasSchema = z.object({
  value: singleLineText(1, 60),
  caseSensitive: z.boolean().optional(),
});

const createSchema = z.object({
  name: singleLineText(1, 100),
  domains: z.array(domainField()).min(1).max(10),
  aliases: z.array(aliasSchema).max(10).default([]),
  isBrand: z.boolean().default(false),
});

entityRoutes.post('/', async (c) => {
  const data = await parseBody(c, createSchema);
  const ws = c.get('workspace').id;
  const existing = await getDb(c.env)
    .select({ id: entities.id, isBrand: entities.isBrand })
    .from(entities)
    .where(eq(entities.workspaceId, ws));
  if (data.isBrand && existing.some((e) => e.isBrand)) {
    return c.json({ error: 'this workspace already has a brand entity' }, 409);
  }
  const created = await createEntity(c.env, ws, {
    name: data.name,
    domains: data.domains,
    aliases: data.aliases,
    isBrand: data.isBrand,
  });
  if (!created.ok) {
    return c.json({ error: 'entity already exists' }, 409);
  }
  return c.json(created.entity, 201);
});

const updateSchema = z.object({
  name: singleLineText(1, 100).optional(),
  domains: z.array(domainField()).min(1).max(10).optional(),
  aliases: z.array(aliasSchema).max(10).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

entityRoutes.patch('/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) {
    return c.json({ error: 'invalid id' }, 400);
  }
  const data = await parseBody(c, updateSchema);
  const db = getDb(c.env);
  const ws = c.get('workspace').id;
  if (data.name !== undefined) {
    // Without this the workspace+name unique index would surface as a raw 500.
    const clash = await db
      .select({ id: entities.id })
      .from(entities)
      .where(and(eq(entities.workspaceId, ws), eq(entities.name, data.name)));
    if (clash.some((e) => e.id !== id)) {
      return c.json({ error: 'entity already exists' }, 409);
    }
  }
  const updated = await db
    .update(entities)
    .set(data)
    .where(and(eq(entities.id, id), eq(entities.workspaceId, ws)))
    .returning();
  if (!updated[0]) {
    return c.json({ error: 'not found' }, 404);
  }
  return c.json(updated[0]);
});

entityRoutes.delete('/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) {
    return c.json({ error: 'invalid id' }, 400);
  }
  const removed = await removeEntity(c.env, c.get('workspace').id, id);
  if (!removed.ok) {
    if (removed.reason === 'is-brand') {
      return c.json({ error: 'cannot delete the brand entity' }, 409);
    }
    if (removed.reason === 'has-history') {
      return c.json(
        { error: 'entity has scored history; removal would destroy trends' },
        409,
      );
    }
    return c.json({ error: 'not found' }, 404);
  }
  return c.json({ ok: true });
});
