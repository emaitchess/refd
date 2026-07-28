import { describe, expect, test } from 'bun:test';
import {
  MCP_SCOPE,
  OAUTH_PROTOCOL_OPTIONS,
  oauthResourceUrl,
} from './constants';
import {
  createCsrfToken,
  csrfCookie,
  escapeHtml,
  formActionSources,
  validCsrfToken,
} from './security';

describe('OAuth protocol policy', () => {
  test('requires S256 PKCE and exposes only the read scope', () => {
    expect(OAUTH_PROTOCOL_OPTIONS.allowImplicitFlow).toBeFalse();
    expect(OAUTH_PROTOCOL_OPTIONS.allowPlainPKCE).toBeFalse();
    expect(OAUTH_PROTOCOL_OPTIONS.scopesSupported).toEqual([MCP_SCOPE]);
  });

  test('binds hosted tokens to the exact MCP resource', () => {
    expect(
      oauthResourceUrl(
        'https://preview.example.test/api/oauth/authorize',
        'https://refd.ai',
      ),
    ).toBe('https://refd.ai/api/mcp');
  });

  test('uses the request origin for local development', () => {
    expect(
      oauthResourceUrl(
        'https://refdlocal.io/api/oauth/authorize',
        'https://refd.ai',
      ),
    ).toBe('https://refdlocal.io/api/mcp');
  });
});

describe('OAuth consent security', () => {
  test('accepts only the CSRF token bound to the browser cookie', async () => {
    const token = createCsrfToken();
    const cookie = csrfCookie(token).split(';')[0];
    const request = new Request('https://refd.ai/api/oauth/authorize', {
      headers: { Cookie: cookie ?? '' },
    });

    expect(await validCsrfToken(request, token)).toBeTrue();
    expect(await validCsrfToken(request, crypto.randomUUID())).toBeFalse();
  });

  test('escapes dynamic client and workspace text', () => {
    expect(escapeHtml(`<app name="'">`)).toBe(
      '&lt;app name=&quot;&#39;&quot;&gt;',
    );
  });

  test('allows only the validated callback origin in consent form actions', () => {
    expect(formActionSources('http://localhost:58263/callback')).toBe(
      "'self' http://localhost:58263",
    );
    expect(formActionSources('https://client.example/callback?state=one')).toBe(
      "'self' https://client.example",
    );
    expect(formActionSources('data:text/html,unsafe')).toBe("'self'");
    expect(formActionSources('not a URL')).toBe("'self'");
  });
});
