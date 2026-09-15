import { and, eq, isNull } from 'drizzle-orm';
import { type Db, getDb } from '../db/client';
import { mcpConnections } from '../db/schema';
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

export interface RevokedConnection {
  clientId: string;
  grantId: string;
  workspaceIds: number[];
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
  const covered = await db
    .select({ workspaceId: mcpConnections.workspaceId })
    .from(mcpConnections)
    .where(
      and(
        eq(mcpConnections.grantId, row.grantId),
        eq(mcpConnections.userId, input.userId),
        isNull(mcpConnections.revokedAt),
      ),
    );
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
      reason: input.reason,
    }),
  );
  return {
    clientId: row.clientId,
    grantId: row.grantId,
    workspaceIds: covered.map((entry) => entry.workspaceId),
  };
};
