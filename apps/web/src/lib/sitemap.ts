import {
  INDEXABLE_PUBLIC_PATHS,
  PUBLIC_SITE_ORIGIN,
} from '@refd/core/public-pages';

const escapeXml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

export const sitemapXml = (
  paths: readonly string[] = INDEXABLE_PUBLIC_PATHS,
): string =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...paths.map(
      (path) =>
        `  <url><loc>${escapeXml(new URL(path, PUBLIC_SITE_ORIGIN).href)}</loc></url>`,
    ),
    '</urlset>',
    '',
  ].join('\n');
