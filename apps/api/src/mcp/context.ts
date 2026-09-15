import { getMcpAuthContext } from 'agents/mcp/server';
import { and, asc, eq, isNull, lt, or } from 'drizzle-orm';
import { getDb } from '../db/client';
import { apiTokens, mcpConnections, users, workspaces } from '../db/schema';
import type { AppEnv } from '../env';
import {
  type ConnectionProps,
  connectionPropsSchema,
} from '../oauth/connection-props';

const LAST_USED_INTERVAL_MS = 5 * 60 * 1000;

// Defensive cap for all-workspace grants: an administrator account may hold
// many workspaces, but a tool answer listing every one is bounded.
const MAX_ENUMERATED_WORKSPACES = 100;

export interface McpWorkspace {
  id: number;
  name: string;
}

export interface McpPrincipal {
  clientId: string;
  clientName: string;
  connectionRowId: number;
  scopes: string[];
  userEmail: string;
  userId: number;
  // The default (selected) workspace: the workspace tools target when the
  // call passes no selector.
  workspaceId: number;
  workspaceName: string;
  // Every workspace this connection may target; the selector validates
  // against this set and nothing else.
  workspaces: McpWorkspace[];
  // True only when the grant resolves workspaces created after approval
  // (OAuth Allow-all connections): the gate that decides whether a new
  // workspace provisioned by a tool would be targetable at all.
  allWorkspaces: boolean;
  // OAuth grant mirror row vs personal access token: the revoke tool refuses
  // PATs because their revocation lives in Settings' token list.
  tokenKind: 'oauth' | 'pat';
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

// A call may target a workspace only if principal resolution put it in the
// connection's granted set; tool arguments can never widen it.
export const resolveGrantedWorkspace = (
  principal: McpPrincipal,
  workspaceArg: number | undefined,
): McpWorkspace => {
  if (workspaceArg === undefined) {
    return {
      id: principal.workspaceId,
      name: principal.workspaceName,
    };
  }
  const granted = principal.workspaces.find(
    (workspace) => workspace.id === workspaceArg,
  );
  if (!granted) {
    throw new McpAccessError('workspace is not part of this connection');
  }
  return granted;
};

const touchConnection = async (
  env: AppEnv,
  connectionKey: string,
  userId: number,
  staleBefore: number,
): Promise<void> => {
  await getDb(env)
    .update(mcpConnections)
    .set({ lastUsedAt: Date.now() })
    .where(
      and(
        eq(mcpConnections.connectionKey, connectionKey),
        eq(mcpConnections.userId, userId),
        isNull(mcpConnections.revokedAt),
        or(
          isNull(mcpConnections.lastUsedAt),
          lt(mcpConnections.lastUsedAt, staleBefore),
        ),
      ),
    );
};

const touchToken = async (
  env: AppEnv,
  tokenRowId: number,
  staleBefore: number,
): Promise<void> => {
  await getDb(env)
    .update(apiTokens)
    .set({ lastUsedAt: Date.now() })
    .where(
      and(
        eq(apiTokens.id, tokenRowId),
        or(isNull(apiTokens.lastUsedAt), lt(apiTokens.lastUsedAt, staleBefore)),
      ),
    );
};

// Personal access tokens resolve through the api_tokens mirror row instead of
// the OAuth grant mirror: same ownership checks (userId + workspaceId +
// connectionKey, not revoked), so revoking a token in Settings invalidates it
// on the next request. Tokens stay single-workspace.
const resolvePatPrincipal = async (
  env: AppEnv,
  executionContext: ExecutionContext,
  props: {
    connectionId: string;
    scopes: string[];
    userId: number;
    workspaceId: number;
  },
): Promise<McpPrincipal> => {
  const row = (
    await getDb(env)
      .select({
        clientName: apiTokens.name,
        clientId: apiTokens.connectionKey,
        tokenRowId: apiTokens.id,
        lastUsedAt: apiTokens.lastUsedAt,
        userEmail: users.email,
        userId: users.id,
        workspaceId: workspaces.id,
        workspaceName: workspaces.name,
      })
      .from(apiTokens)
      .innerJoin(users, eq(apiTokens.userId, users.id))
      .innerJoin(workspaces, eq(apiTokens.workspaceId, workspaces.id))
      .where(
        and(
          eq(apiTokens.connectionKey, props.connectionId),
          eq(apiTokens.userId, props.userId),
          eq(apiTokens.workspaceId, props.workspaceId),
          isNull(apiTokens.revokedAt),
        ),
      )
      .limit(1)
  )[0];
  if (!row) {
    throw new McpAccessError('token is unavailable');
  }
  const staleBefore = Date.now() - LAST_USED_INTERVAL_MS;
  if (row.lastUsedAt === null || row.lastUsedAt < staleBefore) {
    executionContext.waitUntil(
      touchToken(env, row.tokenRowId, staleBefore).catch((error) => {
        console.error(
          JSON.stringify({
            event: 'mcp_token_touch_failed',
            tokenId: row.tokenRowId,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }),
    );
  }
  const workspace = { id: row.workspaceId, name: row.workspaceName };
  return {
    clientId: row.clientId,
    clientName: row.clientName,
    connectionRowId: row.tokenRowId,
    scopes: props.scopes,
    userEmail: row.userEmail,
    userId: row.userId,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    workspaces: [workspace],
    allWorkspaces: false,
    tokenKind: 'pat',
  };
};

// Effective token scopes must be a subset of the live connection's scopes:
// a narrowed token can never outrun what the mirrored grant holds.
const liveConnectionRows = async (env: AppEnv, props: ConnectionProps) =>
  getDb(env)
    .select({
      clientName: mcpConnections.clientName,
      clientId: mcpConnections.clientId,
      connectionRowId: mcpConnections.id,
      connectionScopes: mcpConnections.scopes,
      allWorkspaces: mcpConnections.allWorkspaces,
      workspaceId: mcpConnections.workspaceId,
      workspaceName: workspaces.name,
      userEmail: users.email,
      lastUsedAt: mcpConnections.lastUsedAt,
    })
    .from(mcpConnections)
    .innerJoin(users, eq(mcpConnections.userId, users.id))
    .innerJoin(workspaces, eq(mcpConnections.workspaceId, workspaces.id))
    .where(
      and(
        eq(mcpConnections.connectionKey, props.connectionId),
        eq(mcpConnections.userId, props.userId),
        isNull(mcpConnections.revokedAt),
      ),
    );

// All-workspace grants enumerate the owner's workspaces at request time, so
// workspaces created after approval join the connection with no re-approval
// and deleted ones leave it automatically.
const enumerateOwnedWorkspaces = (
  env: AppEnv,
  userId: number,
): Promise<McpWorkspace[]> =>
  getDb(env)
    .select({ id: workspaces.id, name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.ownerUserId, userId))
    .orderBy(asc(workspaces.id))
    .limit(MAX_ENUMERATED_WORKSPACES);

const defaultWorkspace = (
  props: ConnectionProps,
  granted: McpWorkspace[],
): McpWorkspace => {
  const first = granted[0];
  if (!first) {
    throw new McpAccessError('connection is unavailable');
  }
  const preferred =
    props.workspaceId !== undefined
      ? granted.find((workspace) => workspace.id === props.workspaceId)
      : undefined;
  return preferred ?? first;
};

export const resolveMcpPrincipal = async (
  env: AppEnv,
  executionContext: ExecutionContext,
): Promise<McpPrincipal> => {
  const props = parseMcpTokenProps(getMcpAuthContext()?.props);
  if (!props) {
    throw new McpAccessError('invalid authorization context');
  }
  if (props.tokenKind === 'pat') {
    if (props.workspaceId === undefined) {
      throw new McpAccessError('invalid authorization context');
    }
    return resolvePatPrincipal(env, executionContext, {
      connectionId: props.connectionId,
      scopes: props.scopes,
      userId: props.userId,
      workspaceId: props.workspaceId,
    });
  }
  const rows = await liveConnectionRows(env, props);
  const row = rows[0];
  if (!row) {
    throw new McpAccessError('connection is unavailable');
  }
  if (!tokenScopesCoveredBy(props.scopes, row.connectionScopes)) {
    throw new McpAccessError('token scopes exceed the connection grant');
  }
  let granted: McpWorkspace[];
  if (row.allWorkspaces && props.allWorkspaces === true) {
    granted = await enumerateOwnedWorkspaces(env, props.userId);
  } else if (props.workspaceIds !== undefined) {
    const checked = new Set(props.workspaceIds);
    granted = [
      ...new Map(
        rows
          .filter((entry) => checked.has(entry.workspaceId))
          .map((entry) => [
            entry.workspaceId,
            { id: entry.workspaceId, name: entry.workspaceName },
          ]),
      ).values(),
    ].sort((a, b) => a.id - b.id);
  } else {
    granted = [{ id: row.workspaceId, name: row.workspaceName }];
  }
  const selected = defaultWorkspace(props, granted);
  const staleBefore = Date.now() - LAST_USED_INTERVAL_MS;
  if (
    rows.some(
      (entry) => entry.lastUsedAt === null || entry.lastUsedAt < staleBefore,
    )
  ) {
    executionContext.waitUntil(
      touchConnection(env, props.connectionId, props.userId, staleBefore).catch(
        (error) => {
          console.error(
            JSON.stringify({
              event: 'mcp_connection_touch_failed',
              connectionKey: props.connectionId,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        },
      ),
    );
  }
  return {
    clientId: row.clientId,
    clientName: row.clientName,
    connectionRowId: row.connectionRowId,
    scopes: props.scopes,
    userEmail: row.userEmail,
    userId: props.userId,
    workspaceId: selected.id,
    workspaceName: selected.name,
    workspaces: granted,
    allWorkspaces: row.allWorkspaces && props.allWorkspaces === true,
    tokenKind: 'oauth',
  };
};
