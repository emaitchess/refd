import { getMcpAuthContext } from 'agents/mcp/server';
import { and, desc, eq, isNull, lt, or } from 'drizzle-orm';
import { getDb } from '../db/client';
import { mcpConnections, users, workspaces } from '../db/schema';
import type { AppEnv } from '../env';
import { connectionPropsSchema } from '../oauth/connection-props';
import { MCP_SCOPE } from '../oauth/constants';

const LAST_USED_INTERVAL_MS = 5 * 60 * 1000;

export interface McpPrincipal {
  clientId: string;
  clientName: string;
  connectionRowId: number;
  userEmail: string;
  userId: number;
  workspaceId: number;
  workspaceName: string;
}

export class McpAccessError extends Error {}

export const parseMcpTokenProps = (value: unknown) => {
  const props = connectionPropsSchema.safeParse(value);
  if (!props.success || props.data.scopes[0] !== MCP_SCOPE) {
    return null;
  }
  return props.data;
};

const touchConnection = async (
  env: AppEnv,
  connectionRowId: number,
  staleBefore: number,
): Promise<void> => {
  await getDb(env)
    .update(mcpConnections)
    .set({ lastUsedAt: Date.now() })
    .where(
      and(
        eq(mcpConnections.id, connectionRowId),
        or(
          isNull(mcpConnections.lastUsedAt),
          lt(mcpConnections.lastUsedAt, staleBefore),
        ),
      ),
    );
};

export const resolveMcpPrincipal = async (
  env: AppEnv,
  executionContext: ExecutionContext,
): Promise<McpPrincipal> => {
  const props = parseMcpTokenProps(getMcpAuthContext()?.props);
  if (!props) {
    throw new McpAccessError('invalid authorization context');
  }
  const row = (
    await getDb(env)
      .select({
        clientName: mcpConnections.clientName,
        clientId: mcpConnections.clientId,
        connectionRowId: mcpConnections.id,
        lastUsedAt: mcpConnections.lastUsedAt,
        userEmail: users.email,
        userId: users.id,
        workspaceId: workspaces.id,
        workspaceName: workspaces.name,
      })
      .from(workspaces)
      .innerJoin(users, eq(workspaces.ownerUserId, users.id))
      .innerJoin(
        mcpConnections,
        and(
          eq(mcpConnections.workspaceId, workspaces.id),
          eq(mcpConnections.userId, users.id),
        ),
      )
      .where(
        and(
          eq(workspaces.id, props.workspaceId),
          eq(users.id, props.userId),
          eq(mcpConnections.connectionKey, props.connectionId),
          isNull(mcpConnections.revokedAt),
        ),
      )
      .orderBy(desc(mcpConnections.id))
      .limit(1)
  )[0];
  if (!row) {
    throw new McpAccessError('connection is unavailable');
  }
  const staleBefore = Date.now() - LAST_USED_INTERVAL_MS;
  if (row.lastUsedAt === null || row.lastUsedAt < staleBefore) {
    executionContext.waitUntil(
      touchConnection(env, row.connectionRowId, staleBefore).catch((error) => {
        console.error(
          JSON.stringify({
            event: 'mcp_connection_touch_failed',
            connectionId: row.connectionRowId,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }),
    );
  }
  return {
    clientId: row.clientId,
    clientName: row.clientName,
    connectionRowId: row.connectionRowId,
    userEmail: row.userEmail,
    userId: row.userId,
    workspaceId: row.workspaceId,
    workspaceName: row.workspaceName,
  };
};
