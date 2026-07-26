import { describe, expect, test } from 'bun:test';
import { generateSitemap, publicPathFromHtml } from './sitemap';

describe('generateSitemap', () => {
  test('generates a valid sitemap for public canonical pages', () => {
    expect(generateSitemap(['/'])).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        '  <url>',
        '    <loc>https://refd.ai/</loc>',
        '  </url>',
        '</urlset>',
        '',
      ].join('\n'),
    );
  });

  test('rejects duplicate and non-path entries', () => {
    expect(() => generateSitemap(['/', '/'])).toThrow(
      'Sitemap paths must be unique',
    );
    expect(() => generateSitemap(['https://example.com'])).toThrow(
      'Invalid public sitemap path',
    );
    expect(() => generateSitemap(['//example.com'])).toThrow(
      'Invalid public sitemap path',
    );
    expect(() => generateSitemap(['/app/home'])).toThrow(
      'Sitemap paths must not include application routes',
    );
  });

  test('maps generated Astro HTML to canonical public paths', () => {
    expect(publicPathFromHtml('index.html')).toBe('/');
    expect(publicPathFromHtml('docs.html')).toBe('/docs');
    expect(publicPathFromHtml('blog/first-post.html')).toBe('/blog/first-post');
    expect(publicPathFromHtml('guides/index.html')).toBe('/guides');
    expect(publicPathFromHtml('404.html')).toBeNull();
    expect(publicPathFromHtml('app.html')).toBeNull();
    expect(publicPathFromHtml('app/home.html')).toBeNull();
  });
});
