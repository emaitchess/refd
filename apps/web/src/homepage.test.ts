import { describe, expect, test } from 'bun:test';
import { acceptsMarkdown, handleHomepage } from './homepage';

describe('acceptsMarkdown', () => {
  test('requires an explicit acceptable Markdown media type', () => {
    expect(acceptsMarkdown('text/markdown')).toBe(true);
    expect(acceptsMarkdown('text/html, text/markdown;q=0.8')).toBe(true);
    expect(acceptsMarkdown('text/markdown;q=0')).toBe(false);
    expect(acceptsMarkdown('text/html, text/*;q=0.9, */*;q=0.8')).toBe(false);
    expect(acceptsMarkdown(null)).toBe(false);
  });
});

describe('handleHomepage', () => {
  test('serves the Markdown asset with representation headers', async () => {
    let fetchedPath = '';
    const response = await handleHomepage(
      new Request('https://refd.ai/', {
        headers: { Accept: 'text/markdown, text/html;q=0.5' },
      }),
      async (request) => {
        fetchedPath = new URL(request.url).pathname;
        return new Response('# refd', {
          headers: { Vary: 'Accept-Encoding' },
        });
      },
    );

    expect(fetchedPath).toBe('/index.md');
    expect(response?.headers.get('Content-Type')).toBe(
      'text/markdown; charset=utf-8',
    );
    expect(response?.headers.get('Vary')).toBe('Accept-Encoding, Accept');
    expect(await response?.text()).toBe('# refd');
  });

  test('serves the HTML asset and still varies the root response by Accept', async () => {
    let fetchedPath = '';
    const response = await handleHomepage(
      new Request('https://refd.ai/', {
        headers: { Accept: 'text/html' },
      }),
      async (request) => {
        fetchedPath = new URL(request.url).pathname;
        return new Response('<!doctype html>', {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      },
    );

    expect(fetchedPath).toBe('/');
    expect(response?.headers.get('Content-Type')).toBe(
      'text/html; charset=utf-8',
    );
    expect(response?.headers.get('Vary')).toBe('Accept');
  });

  test('ignores non-homepage requests', async () => {
    let called = false;
    const response = await handleHomepage(
      new Request('https://refd.ai/health'),
      async () => {
        called = true;
        return new Response();
      },
    );

    expect(response).toBeNull();
    expect(called).toBe(false);
  });
});
