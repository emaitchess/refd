import { afterEach, describe, expect, test } from 'bun:test';
import { checkDomain } from './domain-check';

const refresh = (status: number, location: string): Response =>
  new Response(null, { status, headers: { location } });

afterEach(() => {
  delete (globalThis as { fetch?: unknown }).fetch;
});

describe('checkDomain', () => {
  test('a live domain resolves on its own status', async () => {
    globalThis.fetch = (async () =>
      new Response(null, { status: 200 })) as unknown as typeof fetch;
    const check = await checkDomain('peec.ai');
    expect(check.resolved).toBe(true);
    expect(check.status).toBe(200);
    expect(check.finalUrl).toBe('https://peec.ai/');
    expect(check.redirects).toHaveLength(0);
  });

  test('the chain ends at the first non-redirect status', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://scrunchai.com/') {
        return refresh(301, 'https://scrunch.com/');
      }
      if (url === 'https://scrunch.com/') {
        return new Response(null, { status: 200 });
      }
      throw new Error('unreachable');
    }) as unknown as typeof fetch;
    const check = await checkDomain('scrunchai.com');
    expect(check.status).toBe(200);
    expect(check.finalUrl).toBe('https://scrunch.com/');
    expect(check.redirects).toEqual(['https://scrunch.com/']);
  });

  test('apex failure falls back to www when that answers', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).startsWith('https://brandlight.ai')) {
        return new Response(null, { status: 200 });
      }
      throw new Error('connection refused');
    }) as unknown as typeof fetch;
    const check = await checkDomain('brandlight.ai');
    expect(check.resolved).toBe(true);
    expect(check.status).toBe(200);
  });

  test('nothing answering leaves the check unresolved', async () => {
    globalThis.fetch = (async () => {
      throw new Error('connection refused');
    }) as unknown as typeof fetch;
    const check = await checkDomain('brandlight.com');
    expect(check.resolved).toBe(false);
    expect(check.status).toBeNull();
    expect(check.finalUrl).toBeNull();
  });
});
