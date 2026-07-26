import {
  INDEXABLE_PUBLIC_PATHS,
  PUBLIC_SITE_ORIGIN,
} from '../src/shared/public-pages';

const XML_ENTITIES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '"': '&quot;',
  "'": '&apos;',
  '<': '&lt;',
  '>': '&gt;',
};

const escapeXml = (value: string) =>
  value.replace(
    /[&"'<>]/g,
    (character) => XML_ENTITIES[character] ?? character,
  );

const absolutePublicUrl = (path: string, origin: string) => {
  if (
    !path.startsWith('/') ||
    path.startsWith('//') ||
    path.includes('?') ||
    path.includes('#')
  ) {
    throw new Error(`Invalid public sitemap path: ${path}`);
  }

  const url = new URL(path, origin);
  if (url.origin !== origin) {
    throw new Error(`Sitemap path escaped the public origin: ${path}`);
  }

  return url.href;
};

export const generateSitemap = (
  paths: readonly string[] = INDEXABLE_PUBLIC_PATHS,
  origin = PUBLIC_SITE_ORIGIN,
) => {
  if (new Set(paths).size !== paths.length) {
    throw new Error('Sitemap paths must be unique');
  }

  const entries = paths
    .map(
      (path) =>
        `  <url>\n    <loc>${escapeXml(
          absolutePublicUrl(path, origin),
        )}</loc>\n  </url>`,
    )
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    entries,
    '</urlset>',
    '',
  ].join('\n');
};
