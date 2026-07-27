// Stamped onto every /api/* response. Authenticated API data is per-user and
// must never be stored by a shared cache and replayed to another client, so
// default to `private, no-store`. Routes that deliberately opt into caching
// (the favicon/image proxies serve public, non-sensitive bytes) set their own
// Cache-Control first, so only fill in the default when none was set.
export const DEFAULT_API_CACHE_CONTROL = 'private, no-store';

export const applyApiResponseHeaders = (headers: Headers): void => {
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  // Same-origin only: no CORS headers are ever emitted.
  if (!headers.has('Cache-Control')) {
    headers.set('Cache-Control', DEFAULT_API_CACHE_CONTROL);
  }
};
