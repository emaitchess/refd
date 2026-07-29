import type { AppEnv } from '../env';

const retryHeaders = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json',
  'Retry-After': '60',
};

const fingerprint = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const oauthActor = async (request: Request, path: string): Promise<string> => {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  if (path === '/oauth/authorize') {
    const clientId = new URL(request.url).searchParams
      .get('client_id')
      ?.slice(0, 200);
    return clientId ? `${ip}:${clientId}` : ip;
  }
  if (path === '/oauth/token') {
    const form = await request
      .clone()
      .formData()
      .catch(() => null);
    const clientId = form?.get('client_id');
    return typeof clientId === 'string' && clientId.length <= 200
      ? `${ip}:${clientId}`
      : ip;
  }
  return ip;
};

export const limitMcpRequest = async (
  request: Request,
  env: Pick<AppEnv, 'MCP_RATE_LIMITER'>,
): Promise<Response | null> => {
  const authorization = request.headers.get('Authorization') ?? '';
  const key = await fingerprint(authorization);
  const { success } = await env.MCP_RATE_LIMITER.limit({ key });
  if (success) {
    return null;
  }
  console.log(
    JSON.stringify({
      event: 'mcp_rate_limited',
      tokenFingerprint: key.slice(0, 16),
    }),
  );
  return new Response(
    JSON.stringify({
      error: 'rate_limit_exceeded',
      error_description: 'Too many MCP requests. Try again shortly.',
    }),
    { status: 429, headers: retryHeaders },
  );
};

export const limitOAuthRequest = async (
  request: Request,
  env: Pick<AppEnv, 'OAUTH_RATE_LIMITER'>,
): Promise<Response | null> => {
  const path = new URL(request.url).pathname;
  if (
    path !== '/oauth/authorize' &&
    path !== '/oauth/token' &&
    path !== '/oauth/register'
  ) {
    return null;
  }
  const actor = await oauthActor(request, path);
  const { success } = await env.OAUTH_RATE_LIMITER.limit({
    key: `${actor}:${path}`,
  });
  if (success) {
    return null;
  }
  console.log(
    JSON.stringify({
      event: 'oauth_rate_limited',
      path,
    }),
  );
  return new Response(
    JSON.stringify({
      error: 'temporarily_unavailable',
      error_description: 'Too many OAuth requests. Try again shortly.',
    }),
    { status: 429, headers: retryHeaders },
  );
};
