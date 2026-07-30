import { describe, expect, test } from 'bun:test';
import { INDEXABLE_PUBLIC_PATHS, PUBLIC_PAGE_PATHS } from './public-pages';

describe('public page catalog', () => {
  test('keeps canonical and indexable paths unique and aligned', () => {
    expect(new Set(PUBLIC_PAGE_PATHS).size).toBe(PUBLIC_PAGE_PATHS.length);
    expect(new Set(INDEXABLE_PUBLIC_PATHS).size).toBe(
      INDEXABLE_PUBLIC_PATHS.length,
    );
    expect(
      INDEXABLE_PUBLIC_PATHS.every((path) => PUBLIC_PAGE_PATHS.includes(path)),
    ).toBe(true);
  });

  test('uses canonical paths without trailing slashes', () => {
    expect(
      PUBLIC_PAGE_PATHS.every((path) => path === '/' || !path.endsWith('/')),
    ).toBe(true);
  });

  test('includes the no-signup demo in public discovery', () => {
    expect(PUBLIC_PAGE_PATHS).toContain('/demo');
    expect(INDEXABLE_PUBLIC_PATHS).toContain('/demo');
  });

  test('includes the surface tracker cluster in discovery', () => {
    for (const path of [
      '/trackers',
      '/chatgpt-visibility-tracker',
      '/perplexity-visibility-tracker',
      '/gemini-visibility-tracker',
      '/google-ai-mode-tracker',
      '/google-ai-overview-tracker',
    ]) {
      expect(PUBLIC_PAGE_PATHS).toContain(path);
      expect(INDEXABLE_PUBLIC_PATHS).toContain(path);
    }
  });

  test('includes the public policies in discovery', () => {
    expect(PUBLIC_PAGE_PATHS).toContain('/privacy');
    expect(PUBLIC_PAGE_PATHS).toContain('/terms');
    expect(INDEXABLE_PUBLIC_PATHS).toContain('/privacy');
    expect(INDEXABLE_PUBLIC_PATHS).toContain('/terms');
  });

  test('includes the public trust pages in discovery', () => {
    for (const path of ['/open-source', '/security', '/support']) {
      expect(PUBLIC_PAGE_PATHS).toContain(path);
      expect(INDEXABLE_PUBLIC_PATHS).toContain(path);
    }
  });
});
