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
});
