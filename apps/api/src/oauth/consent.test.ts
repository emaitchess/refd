import { describe, expect, test } from 'bun:test';
import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import type { AppEnv } from '../env';
import { handleOAuthDefault, oauthAuthorizationErrorResponse } from './consent';

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

  test('returns provider errors to a validated secure callback', () => {
    const response = oauthAuthorizationErrorResponse({
      name: 'AuthorizationError',
      code: 'invalid_scope',
      description: 'The requested scope is not supported.',
      redirectUri: 'https://client.example/oauth/callback',
      state: 'opaque',
      issuer: 'https://api.refd.ai',
    });
    expect(response?.status).toBe(302);
    const location = new URL(response?.headers.get('Location') ?? '');
    expect(location.origin).toBe('https://client.example');
    expect(location.searchParams.get('error')).toBe('invalid_scope');
    expect(location.searchParams.get('state')).toBe('opaque');
    expect(location.searchParams.get('iss')).toBe('https://api.refd.ai');
  });

  test('never redirects a provider error to an insecure callback', async () => {
    const response = oauthAuthorizationErrorResponse({
      name: 'AuthorizationError',
      code: 'invalid_request',
      description: 'Invalid redirect URI.',
      redirectUri: 'http://attacker.example/oauth/callback',
    });
    expect(response?.status).toBe(400);
    expect(response?.headers.get('Location')).toBeNull();
    expect(await response?.text()).toContain('Invalid redirect URI.');
  });
});
