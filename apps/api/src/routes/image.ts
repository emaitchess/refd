import { Hono } from 'hono';
import type { AuthedBindings } from '../auth/middleware';

// One day: OG/preview images change more often than favicons, so cache softer.
const TTL = 60 * 60 * 24;
// Streaming means we never buffer, but reject an implausibly large image up
// front (best-effort: only fires when the upstream declares a length).
const MAX_BYTES = 8 * 1024 * 1024;

// Reserved / private hosts. Cloudflare's edge won't route these anyway, so this
// is defense in depth: the route proxies an arbitrary caller-supplied URL (a
// brand's scraped OG image), unlike the favicon proxy's two fixed hosts.
const isPrivateHost = (hostname: string): boolean => {
  const h = hostname.toLowerCase();
  if (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h.endsWith('.internal')
  ) {
    return true;
  }
  if (h.includes(':')) {
    // IPv6 literal (URL.hostname strips the brackets).
    return (
      h === '::1' ||
      h === '::' ||
      h.startsWith('fc') ||
      h.startsWith('fd') ||
      h.startsWith('fe80')
    );
  }
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) {
    return false;
  }
  const a = Number(m[1]);
  const b = Number(m[2]);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
};

const safeImageUrl = (raw: string): URL | null => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null;
  }
  // Embedded credentials would let a crafted URL smuggle auth to the upstream.
  if (url.username || url.password || isPrivateHost(url.hostname)) {
    return null;
  }
  return url;
};

// Proxies an arbitrary brand image (currently the homepage OG preview) through
// the worker so the browser only ever loads a same-origin image — the strict
// img-src CSP forbids third-party image hosts.
export const imageRoutes = new Hono<AuthedBindings>();

imageRoutes.get('/', async (c) => {
  const target = safeImageUrl((c.req.query('url') ?? '').trim());
  if (!target) {
    return c.json({ error: 'invalid url' }, 400);
  }
  try {
    const upstream = await fetch(target.href, {
      headers: { accept: 'image/*' },
      cf: { cacheEverything: true, cacheTtl: TTL },
    });
    const type = upstream.headers.get('content-type') ?? '';
    if (!upstream.ok || !type.startsWith('image/')) {
      return c.json({ error: 'not found' }, 404);
    }
    if (Number(upstream.headers.get('content-length') ?? '0') > MAX_BYTES) {
      return c.json({ error: 'too large' }, 413);
    }
    return new Response(upstream.body, {
      headers: {
        'Content-Type': type,
        'Cache-Control': `public, max-age=${TTL}, immutable`,
      },
    });
  } catch {
    // Upstream unreachable: the client's onError falls back to hiding the image.
    return c.json({ error: 'not found' }, 404);
  }
});
