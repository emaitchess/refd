const PUBLIC_SITE_ORIGIN = 'https://refd.ai';
const NON_INDEXABLE_PREFIXES = ['/app'] as const;

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

const isIndexablePublicPath = (path: string) =>
  !NON_INDEXABLE_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );

export const generateSitemap = (
  paths: readonly string[],
  origin = PUBLIC_SITE_ORIGIN,
) => {
  if (new Set(paths).size !== paths.length) {
    throw new Error('Sitemap paths must be unique');
  }
  if (paths.some((path) => !isIndexablePublicPath(path))) {
    throw new Error('Sitemap paths must not include application routes');
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

export const publicPathFromHtml = (filePath: string): string | null => {
  const normalized = filePath.replaceAll('\\', '/');
  if (!normalized.endsWith('.html') || normalized === '404.html') {
    return null;
  }

  const withoutExtension = normalized.slice(0, -'.html'.length);
  const publicPath =
    withoutExtension === 'index'
      ? '/'
      : withoutExtension.endsWith('/index')
        ? `/${withoutExtension.slice(0, -'/index'.length)}`
        : `/${withoutExtension}`;
  return isIndexablePublicPath(publicPath) ? publicPath : null;
};
