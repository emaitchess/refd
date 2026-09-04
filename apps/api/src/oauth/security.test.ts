import { describe, expect, test } from 'bun:test';
import {
  MCP_SCOPE,
  OAUTH_PROTOCOL_OPTIONS,
  oauthResourceUrl,
} from './constants';
import {
  callbackTarget,
  createCsrfToken,
  csrfCookie,
  escapeHtml,
  formActionSources,
  hasSecureRegistrationRedirects,
  isSecureOAuthRedirect,
  validCsrfToken,
} from './security';

describe('OAuth protocol policy', () => {
  test('requires S256 PKCE and exposes only the read scope', () => {
    expect(OAUTH_PROTOCOL_OPTIONS.allowImplicitFlow).toBeFalse();
    expect(OAUTH_PROTOCOL_OPTIONS.allowPlainPKCE).toBeFalse();
    expect(OAUTH_PROTOCOL_OPTIONS.clientIdMetadataDocumentEnabled).toBeTrue();
    expect(OAUTH_PROTOCOL_OPTIONS.scopesSupported).toEqual([MCP_SCOPE]);
  });

  test('binds hosted tokens to the exact MCP resource', () => {
    expect(
      oauthResourceUrl(
        'https://preview.example.test/oauth/authorize',
        'https://refd.ai',
      ),
    ).toBe('https://refd.ai/mcp');
  });

  test('uses the request origin for local development', () => {
    expect(
      oauthResourceUrl(
        'https://refdlocal.io/oauth/authorize',
        'https://refd.ai',
      ),
    ).toBe('https://refdlocal.io/mcp');
  });
});

describe('OAuth consent security', () => {
  test('accepts only the CSRF token bound to the browser cookie', async () => {
    const token = createCsrfToken();
    const cookie = csrfCookie(token).split(';')[0];
    const request = new Request('https://refd.ai/oauth/authorize', {
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

  test('requires encrypted remote callbacks while preserving native clients', () => {
    expect(isSecureOAuthRedirect('https://client.example/callback')).toBeTrue();
    expect(isSecureOAuthRedirect('http://localhost:58263/callback')).toBeTrue();
    expect(isSecureOAuthRedirect('http://127.0.0.1:58263/callback')).toBeTrue();
    expect(isSecureOAuthRedirect('cursor://refd/oauth')).toBeTrue();
    expect(isSecureOAuthRedirect('http://client.example/callback')).toBeFalse();
    expect(isSecureOAuthRedirect('ftp://client.example/callback')).toBeFalse();
    expect(
      isSecureOAuthRedirect('https://client.example/callback#fragment'),
    ).toBeFalse();
    expect(isSecureOAuthRedirect('data:text/html,unsafe')).toBeFalse();
  });

  test('rejects registrations containing any insecure callback', () => {
    expect(
      hasSecureRegistrationRedirects({
        redirect_uris: [
          'https://client.example/callback',
          'http://localhost:58263/callback',
        ],
      }),
    ).toBeTrue();
    expect(
      hasSecureRegistrationRedirects({
        redirect_uris: [
          'https://client.example/callback',
          'http://attacker.example/callback',
        ],
      }),
    ).toBeFalse();
    expect(hasSecureRegistrationRedirects({})).toBeFalse();
  });

  test('retains only the security-relevant callback target', () => {
    expect(
      callbackTarget('https://Client.Example:8443/oauth/callback?code=secret'),
    ).toBe('https://client.example:8443');
    expect(callbackTarget('cursor://Refd/oauth/callback')).toBe(
      'cursor://refd',
    );
    expect(callbackTarget('http://attacker.example/callback')).toBeNull();
  });
});
