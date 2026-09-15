import { and, eq, isNull } from 'drizzle-orm';
import { type Db, getDb } from '../db/client';
import { mcpConnections, workspaces } from '../db/schema';
import type { AppEnv } from '../env';

export const revokeOwnedConnections = async (
  env: AppEnv,
  userId: number,
  workspaceId?: number,
): Promise<void> => {
  const predicate =
    workspaceId === undefined
      ? and(eq(mcpConnections.userId, userId), isNull(mcpConnections.revokedAt))
      : and(
          eq(mcpConnections.userId, userId),
          eq(mcpConnections.workspaceId, workspaceId),
          isNull(mcpConnections.revokedAt),
        );
  const rows = await getDb(env)
    .select({
      id: mcpConnections.id,
      grantId: mcpConnections.grantId,
      clientId: mcpConnections.clientId,
      workspaceId: mcpConnections.workspaceId,
    })
    .from(mcpConnections)
    .where(predicate);
  if (rows.length === 0) {
    return;
  }
  if (!env.OAUTH_PROVIDER) {
    throw new Error('connection service unavailable');
  }
  for (const row of rows) {
    await env.OAUTH_PROVIDER.revokeGrant(row.grantId, String(userId));
    console.log(
      JSON.stringify({
        event: 'mcp_connection_revoked',
        clientId: row.clientId,
        connectionId: row.id,
        userId,
        workspaceId: row.workspaceId,
        reason:
          workspaceId === undefined ? 'account_deleted' : 'workspace_deleted',
      }),
    );
  }
};

export interface CoverageReport {
  // An Allow-all grant reaches every workspace the account owns at the moment
  // of revocation, so its coverage is enumerated from ownership rather than
  // mirror rows (consent records such grants as one row on the default
  // workspace).
  kind: 'allow-all' | 'checked';
  workspaceIds: number[];
}

export interface RevokedConnection {
  clientId: string;
  grantId: string;
  coverage: CoverageReport;
}

// Revokes the OAuth grant behind one mirror row and every mirror row of the
// same grant: the Settings route and the MCP revoke_connection tool share this
// single path, so both kill exactly what the connection was approved for.
export const revokeConnectionByRowId = async (
  env: AppEnv,
  db: Db,
  input: { connectionRowId: number; userId: number; reason: string },
): Promise<RevokedConnection | null> => {
  const row = (
    await db
      .select({
        id: mcpConnections.id,
        grantId: mcpConnections.grantId,
        clientId: mcpConnections.clientId,
        userId: mcpConnections.userId,
        revokedAt: mcpConnections.revokedAt,
        allWorkspaces: mcpConnections.allWorkspaces,
      })
      .from(mcpConnections)
      .where(eq(mcpConnections.id, input.connectionRowId))
      .limit(1)
  )[0];
  if (!row || row.userId !== input.userId || row.revokedAt !== null) {
    return null;
  }
  if (!env.OAUTH_PROVIDER) {
    throw new Error('connection service unavailable');
  }
  // Allow-all reached everything the account owned, so the report enumerates
  // ownership at revocation time instead of the single mirror row.
  const coverage: CoverageReport = row.allWorkspaces
    ? {
        kind: 'allow-all',
        workspaceIds: (
          await db
            .select({ id: workspaces.id })
            .from(workspaces)
            .where(eq(workspaces.ownerUserId, input.userId))
        ).map((entry) => entry.id),
      }
    : {
        kind: 'checked',
        workspaceIds: (
          await db
            .select({ workspaceId: mcpConnections.workspaceId })
            .from(mcpConnections)
            .where(
              and(
                eq(mcpConnections.grantId, row.grantId),
                eq(mcpConnections.userId, input.userId),
                isNull(mcpConnections.revokedAt),
              ),
            )
        ).map((entry) => entry.workspaceId),
      };
  await env.OAUTH_PROVIDER.revokeGrant(row.grantId, String(input.userId));
  await db
    .update(mcpConnections)
    .set({ revokedAt: Date.now() })
    .where(
      and(
        eq(mcpConnections.grantId, row.grantId),
        eq(mcpConnections.userId, input.userId),
        isNull(mcpConnections.revokedAt),
      ),
    );
  console.log(
    JSON.stringify({
      event: 'mcp_connection_revoked',
      clientId: row.clientId,
      connectionId: row.id,
      userId: input.userId,
      coverage,
      reason: input.reason,
    }),
  );
  return {
    clientId: row.clientId,
    grantId: row.grantId,
    coverage,
  };
};
