import { describe, expect, test } from 'bun:test';
import { oauthReturnPath } from './oauth-next';

describe('oauthReturnPath', () => {
  test('accepts the same-origin authorization endpoint (bridge)', () => {
    const next = encodeURIComponent(
      '/oauth/authorize?client_id=client&state=state',
    );
    expect(oauthReturnPath(`?next=${next}`, 'https://refd.ai')).toBe(
      'https://refd.ai/oauth/authorize?client_id=client&state=state',
    );
  });

  test('accepts the absolute API authorize URL (split)', () => {
    const next = encodeURIComponent(
      'https://api.refd.ai/oauth/authorize?client_id=client&state=state',
    );
    expect(oauthReturnPath(`?next=${next}`, 'https://api.refd.ai')).toBe(
      'https://api.refd.ai/oauth/authorize?client_id=client&state=state',
    );
  });

  test('rejects a target on a different origin than the API', () => {
    const next = encodeURIComponent(
      'https://dash.refd.ai/oauth/authorize?client_id=client',
    );
    expect(oauthReturnPath(`?next=${next}`, 'https://api.refd.ai')).toBeNull();
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
        `?next=${encodeURIComponent('/auth/account')}`,
        'https://refd.ai',
      ),
    ).toBeNull();
  });
});
