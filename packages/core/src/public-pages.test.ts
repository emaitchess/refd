import { describe, expect, test } from 'bun:test';
import { GLOSSARY_ENTRY_PATHS } from './glossary-index';
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

  test('includes the published articles in discovery', () => {
    for (const path of [
      '/blog',
      '/blog/what-is-ai-search-monitoring',
      '/blog/ai-mentions-vs-citations',
      '/blog/one-answer-is-not-a-measurement',
      '/blog/how-to-rank-in-ai-overviews',
      '/blog/how-to-build-an-ai-prompt-set',
      '/blog/how-to-audit-an-ai-visibility-tool',
      '/blog/ai-visibility-vs-seo-rankings',
      '/blog/reporting-ai-visibility-to-leadership',
      '/blog/tracking-brand-visibility-in-chatgpt',
      '/blog/monitoring-citations-in-perplexity',
      '/blog/measuring-gemini-brand-mentions',
      '/blog/google-ai-mode-vs-ai-overviews',
      '/blog/why-ai-surfaces-disagree',
    ]) {
      expect(PUBLIC_PAGE_PATHS).toContain(path);
      expect(INDEXABLE_PUBLIC_PATHS).toContain(path);
    }
  });

  test('includes the glossary hub and every definition in discovery', () => {
    expect(PUBLIC_PAGE_PATHS).toContain('/glossary');
    expect(INDEXABLE_PUBLIC_PATHS).toContain('/glossary');
    expect(GLOSSARY_ENTRY_PATHS.length).toBeGreaterThan(0);
    for (const path of GLOSSARY_ENTRY_PATHS) {
      expect(PUBLIC_PAGE_PATHS).toContain(path);
      expect(INDEXABLE_PUBLIC_PATHS).toContain(path);
    }
  });

  test('includes the tool comparison in discovery', () => {
    expect(PUBLIC_PAGE_PATHS).toContain('/compare/ai-visibility-tools');
    expect(INDEXABLE_PUBLIC_PATHS).toContain('/compare/ai-visibility-tools');
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
