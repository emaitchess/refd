import type {
  GrantSummary,
  OAuthHelpers,
} from '@cloudflare/workers-oauth-provider';
import { surfaceLimitMessage } from '@refd/core/config';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { WorkspaceBindings } from '../auth/middleware';
import { getDb } from '../db/client';
import { mcpConnections, workspaces } from '../db/schema';
import { parseBody, parseId } from '../lib/http';
import { configForUser } from '../lib/user-config';
import { enabledSurfaces, SURFACES } from '../providers/types';

// `listUserGrants` reads OAUTH_KV via an eventually-consistent list, so a
// just-created grant can be absent from the result for up to ~a minute. Without
// a grace window, opening Settings right after connecting would find the fresh
// grant "missing" and permanently revoke a connection that is actually live.
// Only reconcile a row as stale once it is older than this window.
export const RECONCILE_GRACE_MS = 10 * 60 * 1000;

export const isStaleConnection = (
  row: { grantId: string; createdAt: number },
  activeGrantIds: ReadonlySet<string>,
  now: number,
  graceMs: number = RECONCILE_GRACE_MS,
): boolean => !activeGrantIds.has(row.grantId) && now - row.createdAt > graceMs;

export const settingsRoutes = new Hono<WorkspaceBindings>();

// Workspace-level run settings. Currently just the enabled AI surfaces; shared
// by the onboarding prompts step and the dashboard Settings page.
settingsRoutes.get('/', async (c) => {
  const db = getDb(c.env);
  const maxSurfaces = configForUser(c.get('user').email, c.env.ADMIN_EMAILS)
    .limits.maxEnabledSurfacesPerWorkspace;
  const ws = (
    await db
      .select({ surfaces: workspaces.surfaces })
      .from(workspaces)
      .where(eq(workspaces.id, c.get('workspace').id))
  )[0];
  return c.json({
    surfaces: enabledSurfaces(ws?.surfaces ?? null, maxSurfaces),
    available: SURFACES,
  });
});

const surfacesSchema = z.object({
  surfaces: z.array(z.enum(SURFACES)).min(1).max(SURFACES.length),
});

settingsRoutes.patch('/', async (c) => {
  const data = await parseBody(c, surfacesSchema);
  const db = getDb(c.env);
  // Dedupe + store in canonical SURFACES order.
  const set = new Set(data.surfaces);
  const surfaces = SURFACES.filter((s) => set.has(s));
  const maxSurfaces = configForUser(c.get('user').email, c.env.ADMIN_EMAILS)
    .limits.maxEnabledSurfacesPerWorkspace;
  if (surfaces.length > maxSurfaces) {
    return c.json({ error: surfaceLimitMessage(maxSurfaces) }, 409);
  }
  await db
    .update(workspaces)
    .set({ surfaces })
    .where(eq(workspaces.id, c.get('workspace').id));
  return c.json({ surfaces });
});

const listUserGrants = async (
  oauth: OAuthHelpers,
  userId: string,
): Promise<GrantSummary[]> => {
  const grants: GrantSummary[] = [];
  let cursor: string | undefined;
  do {
    const page = await oauth.listUserGrants(userId, { cursor, limit: 1000 });
    grants.push(...page.items);
    cursor = page.cursor;
  } while (cursor);
  return grants;
};

settingsRoutes.get('/connections', async (c) => {
  const db = getDb(c.env);
  const workspaceId = c.get('workspace').id;
  const userId = c.get('user').id;
  let rows = await db
    .select({
      id: mcpConnections.id,
      grantId: mcpConnections.grantId,
      clientName: mcpConnections.clientName,
      scopes: mcpConnections.scopes,
      createdAt: mcpConnections.createdAt,
      lastUsedAt: mcpConnections.lastUsedAt,
    })
    .from(mcpConnections)
    .where(
      and(
        eq(mcpConnections.workspaceId, workspaceId),
        eq(mcpConnections.userId, userId),
        isNull(mcpConnections.revokedAt),
      ),
    )
    .orderBy(desc(mcpConnections.createdAt));

  if (c.env.OAUTH_PROVIDER && rows.length > 0) {
    const grants = await listUserGrants(c.env.OAUTH_PROVIDER, String(userId));
    const activeGrantIds = new Set(grants.map((grant) => grant.id));
    const now = Date.now();
    const staleIds = rows
      .filter((row) => isStaleConnection(row, activeGrantIds, now))
      .map((row) => row.id);
    if (staleIds.length > 0) {
      await db
        .update(mcpConnections)
        .set({ revokedAt: Date.now() })
        .where(inArray(mcpConnections.id, staleIds));
      rows = rows.filter((row) => !staleIds.includes(row.id));
    }
  }

  return c.json({
    connections: rows.map(({ grantId: _grantId, ...connection }) => connection),
  });
});

settingsRoutes.delete('/connections/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) {
    return c.json({ error: 'invalid connection' }, 400);
  }
  const workspaceId = c.get('workspace').id;
  const userId = c.get('user').id;
  const db = getDb(c.env);
  const connection = (
    await db
      .select({
        id: mcpConnections.id,
        grantId: mcpConnections.grantId,
        clientId: mcpConnections.clientId,
      })
      .from(mcpConnections)
      .where(
        and(
          eq(mcpConnections.id, id),
          eq(mcpConnections.workspaceId, workspaceId),
          eq(mcpConnections.userId, userId),
          isNull(mcpConnections.revokedAt),
        ),
      )
      .limit(1)
  )[0];
  if (!connection) {
    return c.json({ error: 'connection not found' }, 404);
  }
  if (!c.env.OAUTH_PROVIDER) {
    return c.json({ error: 'connection service unavailable' }, 503);
  }
  await c.env.OAUTH_PROVIDER.revokeGrant(connection.grantId, String(userId));
  await db
    .update(mcpConnections)
    .set({ revokedAt: Date.now() })
    .where(eq(mcpConnections.id, connection.id));
  console.log(
    JSON.stringify({
      event: 'mcp_connection_revoked',
      clientId: connection.clientId,
      connectionId: connection.id,
      userId,
      workspaceId,
    }),
  );
  return c.json({ ok: true });
});
