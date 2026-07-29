import { describe, expect, test } from 'bun:test';
import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import type { AppEnv } from '../env';
import { handleOAuthDefault } from './consent';

describe('OAuth consent', () => {
  test('requires a refd session before showing an authorization request', async () => {
    const request = new Request(
      'https://refd.ai/oauth/authorize?client_id=test&state=opaque',
    );
    const response = await handleOAuthDefault(
      request,
      { JWT_SECRET: 'test-secret' } as AppEnv,
      {} as ExecutionContext,
      {} as OAuthHelpers,
      'https://refd.ai/mcp',
    );
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('Location') ?? '');
    expect(location.pathname).toBe('/auth/sign-in');
    expect(location.searchParams.get('next')).toBe(
      '/oauth/authorize?client_id=test&state=opaque',
    );
  });
});
