import { describe, expect, test } from 'bun:test';
import {
  byPublishedDate,
  contentPath,
  formatContentDate,
  isPublished,
} from './content';

describe('contentPath', () => {
  test('maps collections to canonical public paths', () => {
    expect(contentPath('pages', 'methodology')).toBe('/methodology');
    expect(contentPath('docs', 'getting-started')).toBe(
      '/docs/getting-started',
    );
    expect(contentPath('blog', 'field-note')).toBe('/blog/field-note');
  });
});

describe('content metadata helpers', () => {
  test('formats dates in UTC', () => {
    expect(formatContentDate(new Date('2026-07-29T23:30:00-07:00'))).toBe(
      '30 July 2026',
    );
  });

  test('filters drafts and sorts by order before recency', () => {
    expect(isPublished({ data: { draft: false } })).toBe(true);
    expect(isPublished({ data: { draft: true } })).toBe(false);

    const olderFirst = {
      data: { order: 1, publishedAt: new Date('2026-01-01') },
    };
    const newerSecond = {
      data: { order: 2, publishedAt: new Date('2026-07-29') },
    };
    expect([newerSecond, olderFirst].sort(byPublishedDate)).toEqual([
      olderFirst,
      newerSecond,
    ]);
  });
});
