import { describe, expect, test } from 'bun:test';
import { limitMcpRequest, limitOAuthRequest } from './rate-limit';

const limiter = (success: boolean): RateLimit => ({
  limit: async () => ({ success }),
});

describe('MCP and OAuth rate limits', () => {
  test('allows an MCP request inside the token budget', async () => {
    const response = await limitMcpRequest(
      new Request('https://refd.ai/mcp', {
        headers: { Authorization: 'Bearer access-token' },
      }),
      { MCP_RATE_LIMITER: limiter(true) },
    );
    expect(response).toBeNull();
  });

  test('returns a bounded retry response when MCP traffic is limited', async () => {
    const response = await limitMcpRequest(
      new Request('https://refd.ai/mcp', {
        headers: { Authorization: 'Bearer access-token' },
      }),
      { MCP_RATE_LIMITER: limiter(false) },
    );
    expect(response?.status).toBe(429);
    expect(response?.headers.get('Retry-After')).toBe('60');
    expect(await response?.json()).toMatchObject({
      error: 'rate_limit_exceeded',
    });
  });

  test('limits only OAuth protocol endpoints', async () => {
    const env = { OAUTH_RATE_LIMITER: limiter(false) };
    expect(
      await limitOAuthRequest(new Request('https://refd.ai/oauth/token'), env),
    ).toMatchObject({ status: 429 });
    expect(
      await limitOAuthRequest(new Request('https://refd.ai/health'), env),
    ).toBeNull();
  });

  test('does not consume the token request body', async () => {
    const request = new Request('https://refd.ai/oauth/token', {
      method: 'POST',
      headers: {
        'CF-Connecting-IP': '203.0.113.10',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=authorization_code&client_id=client-1',
    });
    await limitOAuthRequest(request, {
      OAUTH_RATE_LIMITER: limiter(true),
    });
    expect(await request.text()).toContain('client_id=client-1');
  });
});
