import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '../db/client';
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
