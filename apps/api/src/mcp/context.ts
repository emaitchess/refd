import { getMcpAuthContext } from 'agents/mcp/server';
import { and, desc, eq, isNull, lt, or } from 'drizzle-orm';
import { getDb } from '../db/client';
import { mcpConnections, users, workspaces } from '../db/schema';
import type { AppEnv } from '../env';
import {
  type ConnectionProps,
  connectionPropsSchema,
} from '../oauth/connection-props';

const LAST_USED_INTERVAL_MS = 5 * 60 * 1000;

export interface McpPrincipal {
  clientId: string;
  clientName: string;
  connectionRowId: number;
  scopes: string[];
  userEmail: string;
  userId: number;
  workspaceId: number;
  workspaceName: string;
}

export class McpAccessError extends Error {}

export const parseMcpTokenProps = (value: unknown): ConnectionProps | null => {
  const props = connectionPropsSchema.safeParse(value);
  if (
    !props.success ||
    new Set(props.data.scopes).size !== props.data.scopes.length
  ) {
    return null;
  }
  return props.data;
};

const tokenScopesCoveredBy = (tokenScopes: string[], granted: string[]) =>
  tokenScopes.every((scope) => granted.includes(scope));

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
        connectionScopes: mcpConnections.scopes,
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
  // Effective token scopes must be a subset of the live connection's scopes:
  // a narrowed token can never outrun what the mirrored grant holds.
  if (!tokenScopesCoveredBy(props.scopes, row.connectionScopes)) {
    throw new McpAccessError('token scopes exceed the connection grant');
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
    scopes: props.scopes,
    userEmail: row.userEmail,
    userId: row.userId,
    workspaceId: row.workspaceId,
    workspaceName: row.workspaceName,
  };
};
