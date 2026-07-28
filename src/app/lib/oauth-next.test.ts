import { describe, expect, test } from 'bun:test';
import { oauthReturnPath } from './oauth-next';

describe('oauthReturnPath', () => {
  test('accepts only the same-origin authorization endpoint', () => {
    const next = encodeURIComponent(
      '/api/oauth/authorize?client_id=client&state=state',
    );
    expect(oauthReturnPath(`?next=${next}`, 'https://refd.ai')).toBe(
      '/api/oauth/authorize?client_id=client&state=state',
    );
  });

  test('rejects external and unrelated return targets', () => {
    expect(
      oauthReturnPath(
        `?next=${encodeURIComponent('https://evil.example/steal')}`,
        'https://refd.ai',
      ),
    ).toBeNull();
    expect(
      oauthReturnPath(
        `?next=${encodeURIComponent('/api/auth/account')}`,
        'https://refd.ai',
      ),
    ).toBeNull();
  });
});
