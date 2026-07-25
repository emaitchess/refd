import { Hono } from 'hono';
import type { AuthedBindings } from '../auth/middleware';

// One week: favicons rarely change, so cache hard at the edge and in the browser.
const TTL = 60 * 60 * 24 * 7;

// Fixed favicon providers, best first. The worker only ever fetches these two
// hosts (never `domain` itself), so this is not an open SSRF proxy — `domain`
// is validated to a bare hostname and url-encoded before use. favicon.im (used
// client-side before) 403s datacenter requests, so it is not usable server-side;
// Google (256px) and DuckDuckGo both serve icons to the worker.
const providers = (domain: string): string[] => {
  const d = encodeURIComponent(domain);
  return [
    `https://www.google.com/s2/favicons?domain=${d}&sz=256`,
    `https://icons.duckduckgo.com/ip3/${d}.ico`,
  ];
};

// Bare hostname only: labels of alphanumerics/hyphens, at least one dot. Rejects
// schemes, paths, ports, credentials — anything that could break out of the
// provider URL above.
const HOSTNAME =
  /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

// Proxies a brand favicon through the worker so the browser only ever loads a
// same-origin image (the strict img-src CSP forbids third-party favicon hosts).
export const faviconRoutes = new Hono<AuthedBindings>();

faviconRoutes.get('/', async (c) => {
  const domain = (c.req.query('domain') ?? '').trim().toLowerCase();
  if (!HOSTNAME.test(domain)) {
    return c.json({ error: 'invalid domain' }, 400);
  }
  for (const url of providers(domain)) {
    try {
      const upstream = await fetch(url, {
        cf: { cacheEverything: true, cacheTtl: TTL },
      });
      const type = upstream.headers.get('content-type') ?? '';
      if (upstream.ok && type.startsWith('image/')) {
        return new Response(upstream.body, {
          headers: {
            'Content-Type': type,
            'Cache-Control': `public, max-age=${TTL}, immutable`,
          },
        });
      }
    } catch {
      // try the next provider
    }
  }
  // No icon: the client's onError falls back to its placeholder.
  return c.json({ error: 'not found' }, 404);
});
