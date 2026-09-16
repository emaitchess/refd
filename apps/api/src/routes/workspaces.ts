import { workspaceDeletionIssue } from '@refd/core/workspaces';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthedBindings } from '../auth/middleware';
import { purgeChatExchange } from '../chat/exchange-do';
import { type Db, getDb } from '../db/client';
import { chats, entities, results, runs, workspaces } from '../db/schema';
import { deleteRunRawObjects } from '../ingest/deletion';
import { parseBody, parseId } from '../lib/http';
import { singleLineText } from '../lib/sanitize';
import { provisionWorkspace } from '../lib/workspace-provision';
import { revokeOwnedConnections } from '../oauth/revoke';

const nameSchema = z.object({ name: singleLineText(1, 60) });
const deleteSchema = z.object({ confirmation: singleLineText(1, 60) });

export const workspaceRoutes = new Hono<AuthedBindings>();

export const claimWorkspaceDeletion = async (
  db: Db,
  userId: number,
  workspaceId: number,
): Promise<boolean> => {
  const claimed = await db
    .update(workspaces)
    .set({ deletingAt: Date.now() })
    .where(
      and(
        eq(workspaces.id, workspaceId),
        eq(workspaces.ownerUserId, userId),
        isNull(workspaces.deletingAt),
        sql`exists (
          select 1 from workspaces remaining
          where remaining.owner_user_id = ${userId}
            and remaining.id <> ${workspaceId}
            and remaining.deleting_at is null
        )`,
      ),
    )
    .returning({ id: workspaces.id });
  return claimed[0] !== undefined;
};

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
  const provisioned = await provisionWorkspace(
    c.env,
    { id: c.get('user').id, email: c.get('user').email },
    data.name,
    null,
  );
  if (!provisioned.ok) {
    return c.json({ error: provisioned.error }, 409);
  }
  return c.json({ id: provisioned.id, name: provisioned.name }, 201);
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
    .select({
      id: workspaces.id,
      name: workspaces.name,
      deletingAt: workspaces.deletingAt,
    })
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
  const target = owned.find((workspace) => workspace.id === id);
  if (target?.deletingAt === null) {
    if (!(await claimWorkspaceDeletion(db, c.get('user').id, id))) {
      return c.json({ error: 'at least one workspace is required' }, 409);
    }
  }
  await revokeOwnedConnections(c.env, c.get('user').id, id);

  const rawKeys = await db
    .select({ key: results.r2Key })
    .from(results)
    .innerJoin(runs, eq(results.runId, runs.id))
    .where(eq(runs.workspaceId, id));
  const runIds = await db
    .select({ id: runs.id })
    .from(runs)
    .where(eq(runs.workspaceId, id));
  const chatIds = await db
    .select({ id: chats.id })
    .from(chats)
    .where(eq(chats.workspaceId, id));
  for (const chat of chatIds) {
    await purgeChatExchange(c.env, chat.id);
  }
  await deleteRunRawObjects(
    c.env,
    runIds.map((run) => run.id),
    rawKeys.map((row) => row.key),
  );
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
    'delete from chat_exchanges where workspace_id = ?',
    'delete from chats where workspace_id = ?',
    'delete from mcp_connections where workspace_id = ?',
    'delete from setup_commits where workspace_id = ?',
    'delete from api_tokens where workspace_id = ?',
  ].map((statement) => c.env.DB.prepare(statement).bind(id));
  statements.push(
    c.env.DB.prepare(
      'delete from workspaces where id = ? and owner_user_id = ?',
    ).bind(id, c.get('user').id),
  );
  await c.env.DB.batch(statements);

  return c.json({ ok: true });
});
