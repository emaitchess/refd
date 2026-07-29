import { describe, expect, test } from 'bun:test';
import {
  INDEXABLE_PUBLIC_PATHS,
  PUBLIC_SITE_ORIGIN,
} from '@refd/core/public-pages';
import { sitemapXml } from './sitemap';

describe('sitemapXml', () => {
  test('emits one URL set containing every indexable canonical page', () => {
    const xml = sitemapXml();

    expect(xml).toStartWith('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    );
    expect(xml).not.toContain('<sitemapindex');
    expect(xml.match(/<url>/g)?.length).toBe(INDEXABLE_PUBLIC_PATHS.length);

    for (const path of INDEXABLE_PUBLIC_PATHS) {
      expect(xml).toContain(
        `<loc>${new URL(path, PUBLIC_SITE_ORIGIN).href}</loc>`,
      );
    }
  });

  test('escapes URL characters that are significant in XML', () => {
    expect(sitemapXml(['/search?one=1&two=2'])).toContain(
      '<loc>https://refd.ai/search?one=1&amp;two=2</loc>',
    );
  });
});
