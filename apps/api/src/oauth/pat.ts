import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '../db/client';
import { apiTokens } from '../db/schema';
import { sha256Hex } from '../lib/hash';
import type { ConnectionProps } from './connection-props';
import { MCP_SCOPE } from './constants';

export const PAT_PREFIX = 'refd_';

export const MAX_ACTIVE_TOKENS_PER_WORKSPACE = 10;

// 32 random bytes, base64url-encoded (43 chars, no padding): `refd_` + 43.
export const PAT_TOKEN_LENGTH = PAT_PREFIX.length + 43;

export const isPersonalAccessToken = (token: string): boolean =>
  token.startsWith(PAT_PREFIX) && token.length === PAT_TOKEN_LENGTH;

export interface GeneratedToken {
  // Shown once at creation, never stored.
  token: string;
  // Shown in the dashboard so the owner can tell tokens apart; carries none of
  // the entropy needed to reconstruct or validate one.
  tokenPrefix: string;
  // Stable UUID embedded in the /mcp authorization props so token resolution
  // can find this row without ever touching the raw secret.
  connectionKey: string;
}

export const generatePersonalAccessToken = (): GeneratedToken => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const random = btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
  const token = `${PAT_PREFIX}${random}`;
  return {
    connectionKey: crypto.randomUUID(),
    token,
    tokenPrefix: token.slice(0, 12),
  };
};

export const hashPersonalAccessToken = (token: string): Promise<string> =>
  sha256Hex(token);

interface TokenRow {
  connectionKey: string;
  userId: number;
  workspaceId: number;
  name: string;
}

// Props handed to /mcp for a valid PAT. The shape matches the OAuth grant
// props except for `tokenKind`, which routes principal resolution to the
// api_tokens mirror row instead of mcp_connections.
export const patConnectionProps = (row: TokenRow): ConnectionProps => ({
  clientName: row.name,
  connectionId: row.connectionKey,
  scopes: [MCP_SCOPE],
  tokenKind: 'pat',
  userId: row.userId,
  workspaceId: row.workspaceId,
});

// Resolves a bearer token that the OAuth provider did not find in its own KV.
// Returns null for anything that is not a well-formed PAT or that does not
// match an active token row; the provider then answers a generic 401.
export const resolvePersonalAccessToken = async (
  env: Parameters<typeof getDb>[0],
  token: string,
): Promise<ConnectionProps | null> => {
  if (!isPersonalAccessToken(token)) {
    return null;
  }
  const tokenHash = await hashPersonalAccessToken(token);
  const row = (
    await getDb(env)
      .select({
        connectionKey: apiTokens.connectionKey,
        userId: apiTokens.userId,
        workspaceId: apiTokens.workspaceId,
        name: apiTokens.name,
      })
      .from(apiTokens)
      .where(
        and(eq(apiTokens.tokenHash, tokenHash), isNull(apiTokens.revokedAt)),
      )
      .limit(1)
  )[0];
  if (!row) {
    return null;
  }
  return patConnectionProps(row);
};
