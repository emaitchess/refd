import type {
  GrantSummary,
  OAuthHelpers,
} from '@cloudflare/workers-oauth-provider';
import { surfaceLimitMessage } from '@refd/core/config';
import {
  DEFAULT_RUN_SCHEDULE,
  parseRunSchedule,
  runScheduleSchema,
} from '@refd/core/schedule';
import { scheduledMonitoringEligible } from '@refd/core/workspaces';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
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
import { revokeConnectionByRowId } from '../oauth/revoke';
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

// Workspace-level run settings: enabled AI surfaces and the run schedule.
// Shared by the onboarding prompts step and the dashboard Settings page.
settingsRoutes.get('/', async (c) => {
  const db = getDb(c.env);
  const maxSurfaces = configForUser(c.get('user').email, c.env.ADMIN_EMAILS)
    .limits.maxEnabledSurfacesPerWorkspace;
  const ws = (
    await db
      .select({
        surfaces: workspaces.surfaces,
        schedule: workspaces.schedule,
        monitoringTier: workspaces.monitoringTier,
        monitoringEndsAt: workspaces.monitoringEndsAt,
      })
      .from(workspaces)
      .where(eq(workspaces.id, c.get('workspace').id))
  )[0];
  return c.json({
    surfaces: enabledSurfaces(ws?.surfaces ?? null, maxSurfaces),
    available: SURFACES,
    schedule: parseRunSchedule(ws?.schedule) ?? DEFAULT_RUN_SCHEDULE,
    // The monitoring policy (tier), not the schedule toggle, decides whether
    // scheduled runs fire at all; the UI states this instead of implying the
    // toggle controls it.
    scheduleActive: ws
      ? scheduledMonitoringEligible(
          ws,
          c.env.SCHEDULED_MONITORING_POLICY,
          Date.now(),
        )
      : false,
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

// The schema output is the canonical stored form: daily collapses interval and
// days; weekly days are deduped and sorted.
settingsRoutes.patch('/schedule', async (c) => {
  const schedule = await parseBody(c, runScheduleSchema);
  const db = getDb(c.env);
  await db
    .update(workspaces)
    .set({ schedule })
    .where(eq(workspaces.id, c.get('workspace').id));
  return c.json({ schedule });
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
      allWorkspaces: mcpConnections.allWorkspaces,
      workspaceId: mcpConnections.workspaceId,
      workspaceName: workspaces.name,
      createdAt: mcpConnections.createdAt,
      lastUsedAt: mcpConnections.lastUsedAt,
    })
    .from(mcpConnections)
    .leftJoin(workspaces, eq(mcpConnections.workspaceId, workspaces.id))
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

  // A connection covers one mirror row per granted workspace: report how many
  // so the revoke confirmation can say what else dies with the grant.
  const grantIds = [...new Set(rows.map((row) => row.grantId))];
  const coverage = new Map<string, number>(
    grantIds.map((grantId) => [grantId, 0]),
  );
  if (grantIds.length > 0) {
    const counts = await db
      .select({
        grantId: mcpConnections.grantId,
        count: sql<number>`count(*)`,
      })
      .from(mcpConnections)
      .where(
        and(
          eq(mcpConnections.userId, userId),
          inArray(mcpConnections.grantId, grantIds),
          isNull(mcpConnections.revokedAt),
        ),
      )
      .groupBy(mcpConnections.grantId);
    for (const entry of counts) {
      coverage.set(entry.grantId, Number(entry.count));
    }
  }

  return c.json({
    connections: rows.map(({ grantId: _grantId, ...connection }) => ({
      ...connection,
      workspaceCount: coverage.get(_grantId) ?? 1,
    })),
  });
});

settingsRoutes.delete('/connections/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) {
    return c.json({ error: 'invalid connection' }, 400);
  }
  const userId = c.get('user').id;
  const db = getDb(c.env);
  if (!c.env.OAUTH_PROVIDER) {
    return c.json({ error: 'connection service unavailable' }, 503);
  }
  const revoked = await revokeConnectionByRowId(c.env, db, {
    connectionRowId: id,
    userId,
    reason: 'settings_revoked',
  });
  if (!revoked) {
    return c.json({ error: 'connection not found' }, 404);
  }
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
