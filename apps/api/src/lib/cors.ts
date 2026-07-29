import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../env';

const CORS_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
const CORS_HEADERS = 'Content-Type';
const CORS_MAX_AGE = '600';
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Local dev serves the dashboard on this same-site subdomain of refdlocal.io.
const LOCAL_DASHBOARD_ORIGIN = 'https://dash.refdlocal.io';

const hostnameOf = (value: string): string | null => {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
};

// refdlocal.io is a local-only domain (mapped to 127.0.0.1). We trust its
// origins directly off the Origin header so local dev needs no config and works
// regardless of how the request URL is presented behind Caddy. This is safe in
// production: the session cookie is SameSite=Strict + host-only to the API, and
// every data route requires it, so a cross-site refdlocal.io page can neither
// send the cookie nor read anything.
const isLocalDevOrigin = (origin: string): boolean =>
  hostnameOf(origin)?.endsWith('refdlocal.io') ?? false;

const isLocalDevHost = (hostname: string | null): boolean =>
  hostname !== null &&
  (hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.endsWith('refdlocal.io'));

const configuredDashboardOrigin = (env: AppEnv): string | undefined =>
  env.DASHBOARD_ORIGIN?.trim() || undefined;

// The dashboard origin for this request — used by the OAuth sign-in redirect,
// which is a top-level navigation with no Origin header to key off. Local dev
// (the API on localhost or *.refdlocal.io) resolves to the local dashboard.
export const dashboardOriginForRequest = (
  requestUrl: string,
  env: AppEnv,
): string | undefined =>
  isLocalDevHost(hostnameOf(requestUrl))
    ? LOCAL_DASHBOARD_ORIGIN
    : configuredDashboardOrigin(env);

// A browser Origin the API trusts: the API's own origin (same-origin), the
// configured dashboard origin, or any local-dev refdlocal.io origin.
export const isAllowedBrowserOrigin = (
  origin: string,
  requestUrl: string,
  env: AppEnv,
): boolean =>
  origin === new URL(requestUrl).origin ||
  origin === configuredDashboardOrigin(env) ||
  isLocalDevOrigin(origin);

const appendVary = (headers: Headers, value: string): void => {
  const existing = headers.get('Vary');
  if (!existing) {
    headers.set('Vary', value);
    return;
  }
  const present = existing
    .split(',')
    .some((header) => header.trim().toLowerCase() === value.toLowerCase());
  if (!present) {
    headers.set('Vary', `${existing}, ${value}`);
  }
};

const preflightResponse = (origin: string): Response =>
  new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': CORS_METHODS,
      'Access-Control-Allow-Headers': CORS_HEADERS,
      'Access-Control-Max-Age': CORS_MAX_AGE,
      Vary: 'Origin',
    },
  });

// Credentialed CORS for trusted cross-origin browser requests (the dashboard
// Worker, or a local-dev subdomain). Answers the JSON preflight and echoes the
// exact Origin (never `*`, which credentials forbid). Same-origin and untrusted
// requests fall through with no CORS headers.
export const dashboardCors = createMiddleware<{ Bindings: AppEnv }>(
  async (c, next) => {
    const origin = c.req.header('Origin');
    if (
      !origin ||
      origin === new URL(c.req.url).origin ||
      !isAllowedBrowserOrigin(origin, c.req.url, c.env)
    ) {
      await next();
      return;
    }
    if (c.req.method === 'OPTIONS') {
      return preflightResponse(origin);
    }
    await next();
    c.res.headers.set('Access-Control-Allow-Origin', origin);
    c.res.headers.set('Access-Control-Allow-Credentials', 'true');
    appendVary(c.res.headers, 'Origin');
  },
);

// CSRF defense in depth: a session-authenticated state change must originate
// from a trusted browser origin. A present-but-untrusted Origin (a cross-site
// attacker) is rejected; the JSON content-type guard already blocks form posts.
export const requireDashboardOrigin = createMiddleware<{ Bindings: AppEnv }>(
  async (c, next) => {
    if (MUTATION_METHODS.has(c.req.method.toUpperCase())) {
      const origin = c.req.header('Origin');
      if (origin && !isAllowedBrowserOrigin(origin, c.req.url, c.env)) {
        return c.json({ error: 'origin not allowed' }, 403);
      }
    }
    await next();
  },
);
