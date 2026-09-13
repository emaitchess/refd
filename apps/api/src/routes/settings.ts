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
import { apiTokens, mcpConnections, workspaces } from '../db/schema';
import { parseBody, parseId } from '../lib/http';
import { singleLineText } from '../lib/sanitize';
import { configForUser } from '../lib/user-config';
import { MCP_SCOPE } from '../oauth/constants';
import {
  generatePersonalAccessToken,
  hashPersonalAccessToken,
  MAX_ACTIVE_TOKENS_PER_WORKSPACE,
} from '../oauth/pat';
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
      callbackTarget: mcpConnections.callbackTarget,
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

// Personal access tokens: workspace-scoped read-only bearer tokens for
// headless agents and CI. Same scope and mirror-row checks as an OAuth grant;
// only the SHA-256 hash is stored.
settingsRoutes.get('/tokens', async (c) => {
  const db = getDb(c.env);
  const rows = await db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      tokenPrefix: apiTokens.tokenPrefix,
      createdAt: apiTokens.createdAt,
      lastUsedAt: apiTokens.lastUsedAt,
    })
    .from(apiTokens)
    .where(
      and(
        eq(apiTokens.workspaceId, c.get('workspace').id),
        eq(apiTokens.userId, c.get('user').id),
        isNull(apiTokens.revokedAt),
      ),
    )
    .orderBy(desc(apiTokens.createdAt));
  return c.json({ tokens: rows });
});

const createTokenSchema = z.object({ name: singleLineText(1, 60) });

settingsRoutes.post('/tokens', async (c) => {
  const data = await parseBody(c, createTokenSchema);
  const workspaceId = c.get('workspace').id;
  const userId = c.get('user').id;
  const generated = generatePersonalAccessToken();
  const tokenHash = await hashPersonalAccessToken(generated.token);
  // Count guard and insert in one statement so concurrent creates cannot both
  // pass a stale preflight count.
  const row = await c.env.DB.prepare(
    `insert into api_tokens
       (token_hash, token_prefix, connection_key, name, workspace_id, user_id, scopes)
     select ?, ?, ?, ?, ?, ?, ?
     where (
       select count(*) from api_tokens
       where workspace_id = ? and user_id = ? and revoked_at is null
     ) < ?
     returning id, token_prefix, created_at`,
  )
    .bind(
      tokenHash,
      generated.tokenPrefix,
      generated.connectionKey,
      data.name,
      workspaceId,
      userId,
      JSON.stringify([MCP_SCOPE]),
      workspaceId,
      userId,
      MAX_ACTIVE_TOKENS_PER_WORKSPACE,
    )
    .first<{ id: number; token_prefix: string; created_at: number }>();
  if (row === null) {
    return c.json(
      {
        error: `up to ${MAX_ACTIVE_TOKENS_PER_WORKSPACE} active tokens per workspace`,
      },
      409,
    );
  }
  console.log(
    JSON.stringify({
      event: 'pat_created',
      tokenId: row.id,
      userId,
      workspaceId,
    }),
  );
  return c.json(
    {
      // The only time the raw token ever leaves the server.
      token: generated.token,
      record: {
        id: row.id,
        name: data.name,
        tokenPrefix: row.token_prefix,
        createdAt: row.created_at,
        lastUsedAt: null,
      },
    },
    201,
  );
});

settingsRoutes.delete('/tokens/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) {
    return c.json({ error: 'invalid token' }, 400);
  }
  const db = getDb(c.env);
  const updated = await db
    .update(apiTokens)
    .set({ revokedAt: Date.now() })
    .where(
      and(
        eq(apiTokens.id, id),
        eq(apiTokens.workspaceId, c.get('workspace').id),
        eq(apiTokens.userId, c.get('user').id),
        isNull(apiTokens.revokedAt),
      ),
    )
    .returning({ id: apiTokens.id });
  if (!updated[0]) {
    return c.json({ error: 'token not found' }, 404);
  }
  console.log(
    JSON.stringify({
      event: 'pat_revoked',
      tokenId: updated[0].id,
      userId: c.get('user').id,
      workspaceId: c.get('workspace').id,
    }),
  );
  return c.json({ ok: true });
});
