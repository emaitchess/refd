import { describe, expect, test } from 'bun:test';
import { applyApiResponseHeaders } from './response-headers';

describe('applyApiResponseHeaders', () => {
  test('defaults an unset Cache-Control to private, no-store', () => {
    const headers = new Headers();
    applyApiResponseHeaders(headers);
    expect(headers.get('Cache-Control')).toBe('private, no-store');
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('Referrer-Policy')).toBe('no-referrer');
  });

  test('never overrides a Cache-Control a route already set', () => {
    const headers = new Headers({
      'Cache-Control': 'public, max-age=604800, immutable',
    });
    applyApiResponseHeaders(headers);
    expect(headers.get('Cache-Control')).toBe(
      'public, max-age=604800, immutable',
    );
  });
});
