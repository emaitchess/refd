import { workspaceLimitMessage } from '@refd/core/config';
import {
  defaultMonitoringTier,
  workspaceDeletionIssue,
} from '@refd/core/workspaces';
import { and, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthedBindings } from '../auth/middleware';
import { getDb } from '../db/client';
import { entities, results, runs, workspaces } from '../db/schema';
import { parseBody, parseId } from '../lib/http';
import { singleLineText } from '../lib/sanitize';
import { configForUser } from '../lib/user-config';
import { revokeOwnedConnections } from '../oauth/revoke';

const nameSchema = z.object({ name: singleLineText(1, 60) });
const deleteSchema = z.object({ confirmation: singleLineText(1, 60) });
const createdWorkspaceSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
});

export const workspaceRoutes = new Hono<AuthedBindings>();

workspaceRoutes.get('/', async (c) => {
  const db = getDb(c.env);
  const rows = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.ownerUserId, c.get('user').id))
    .orderBy(workspaces.id);
  // hasBrand drives onboarding: a workspace without a brand entity is not yet
  // set up. The domain rides along from the same query — it's the workspace's
  // favicon in the switcher and in Settings.
  const brands = rows.length
    ? await db
        .select({
          workspaceId: entities.workspaceId,
          domains: entities.domains,
        })
        .from(entities)
        .where(
          and(
            eq(entities.isBrand, true),
            inArray(
              entities.workspaceId,
              rows.map((w) => w.id),
            ),
          ),
        )
    : [];
  const brandDomain = new Map(
    brands.map((b) => [b.workspaceId, b.domains[0] ?? null]),
  );
  return c.json({
    workspaces: rows.map((w) => ({
      id: w.id,
      name: w.name,
      hasBrand: brandDomain.has(w.id),
      brandDomain: brandDomain.get(w.id) ?? null,
      onboardingCompleted: w.onboardingCompleted,
    })),
  });
});

workspaceRoutes.post('/', async (c) => {
  const data = await parseBody(c, nameSchema);
  const ownerId = c.get('user').id;
  const config = configForUser(c.get('user').email, c.env.ADMIN_EMAILS);
  const limit = config.limits.maxWorkspaces;
  const tier = defaultMonitoringTier(config.isAdmin);
  // Keep the count guard and insert in one statement so concurrent requests
  // cannot both pass a stale preflight count.
  const row = await c.env.DB.prepare(
    `insert into workspaces (name, owner_user_id, monitoring_tier)
     select ?, ?, ?
     where ? is null or (
       select count(*) from workspaces where owner_user_id = ?
     ) < ?
     returning id, name`,
  )
    .bind(data.name, ownerId, tier, limit, ownerId, limit)
    .first();
  if (row === null) {
    if (limit === null) {
      throw new Error('unlimited workspace insert returned no row');
    }
    return c.json({ error: workspaceLimitMessage(limit) }, 409);
  }
  const inserted = createdWorkspaceSchema.safeParse(row);
  if (!inserted.success) {
    throw new Error('workspace insert returned an invalid row');
  }
  return c.json(inserted.data, 201);
});

workspaceRoutes.patch('/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) {
    return c.json({ error: 'invalid workspace' }, 400);
  }
  const data = await parseBody(c, nameSchema);
  const db = getDb(c.env);
  const updated = await db
    .update(workspaces)
    .set({ name: data.name })
    .where(
      and(eq(workspaces.id, id), eq(workspaces.ownerUserId, c.get('user').id)),
    )
    .returning();
  if (!updated[0]) {
    return c.json({ error: 'workspace not found' }, 404);
  }
  return c.json({ id: updated[0].id, name: updated[0].name });
});

workspaceRoutes.delete('/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) {
    return c.json({ error: 'invalid workspace' }, 400);
  }
  const data = await parseBody(c, deleteSchema);
  const db = getDb(c.env);
  const owned = await db
    .select({ id: workspaces.id, name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.ownerUserId, c.get('user').id));
  const issue = workspaceDeletionIssue(owned, id, data.confirmation);
  if (issue === 'not_found') {
    return c.json({ error: 'workspace not found' }, 404);
  }
  if (issue === 'last_workspace') {
    return c.json({ error: 'at least one workspace is required' }, 409);
  }
  if (issue === 'confirmation_mismatch') {
    return c.json({ error: 'workspace name does not match' }, 400);
  }
  await revokeOwnedConnections(c.env, c.get('user').id, id);

  const rawKeys = await db
    .select({ key: results.r2Key })
    .from(results)
    .innerJoin(runs, eq(results.runId, runs.id))
    .where(eq(runs.workspaceId, id));
  const keys = rawKeys.flatMap((row) => (row.key ? [row.key] : []));
  for (let start = 0; start < keys.length; start += 1000) {
    await c.env.RAW.delete(keys.slice(start, start + 1000));
  }

  const statements = [
    `delete from citations where result_id in (
      select results.id from results
      join runs on results.run_id = runs.id
      where runs.workspace_id = ?
    )`,
    `delete from entity_scores where result_id in (
      select results.id from results
      join runs on results.run_id = runs.id
      where runs.workspace_id = ?
    )`,
    `delete from results where run_id in (
      select id from runs where workspace_id = ?
    )`,
    `delete from snapshots where run_id in (
      select id from runs where workspace_id = ?
    )`,
    'delete from runs where workspace_id = ?',
    'delete from prompts where workspace_id = ?',
    'delete from entities where workspace_id = ?',
    `delete from chat_messages where chat_id in (
      select id from chats where workspace_id = ?
    )`,
    'delete from chats where workspace_id = ?',
    'delete from mcp_connections where workspace_id = ?',
  ].map((statement) => c.env.DB.prepare(statement).bind(id));
  statements.push(
    c.env.DB.prepare(
      'delete from workspaces where id = ? and owner_user_id = ?',
    ).bind(id, c.get('user').id),
  );
  await c.env.DB.batch(statements);

  return c.json({ ok: true });
});
