import { describe, expect, test } from 'bun:test';
import { addedUrls, sitemapUrls } from './deploy-web';

describe('IndexNow deploy integration', () => {
  test('extracts escaped URLs from a sitemap', () => {
    expect(
      sitemapUrls(`
        <urlset>
          <url><loc>https://refd.ai/</loc></url>
          <url><loc>https://refd.ai/search?one=1&amp;two=2</loc></url>
        </urlset>
      `),
    ).toEqual(['https://refd.ai/', 'https://refd.ai/search?one=1&two=2']);
  });

  test('returns only canonical URLs absent from the deployed sitemap', () => {
    expect(
      addedUrls(
        ['/', '/docs', '/new-page', '/new-page'],
        ['https://refd.ai/', 'https://refd.ai/docs'],
      ),
    ).toEqual(['https://refd.ai/new-page']);
  });
});
