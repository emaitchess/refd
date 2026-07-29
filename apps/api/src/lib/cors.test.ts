import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import {
  dashboardCors,
  isAllowedBrowserOrigin,
  requireDashboardOrigin,
} from './cors';

const API = 'https://api.refd.ai';
const DASH = 'https://dash.refd.ai';
const splitEnv = { DASHBOARD_ORIGIN: DASH } as AppEnv;
const bridgeEnv = {} as AppEnv;

const app = () => {
  const instance = new Hono<{ Bindings: AppEnv }>();
  instance.use('/*', dashboardCors);
  instance.use('/*', requireDashboardOrigin);
  instance.get('/x', (c) => c.json({ ok: true }));
  instance.post('/x', (c) => c.json({ ok: true }));
  return instance;
};

const req = (init: RequestInit, env: AppEnv) =>
  app().request(`${API}/x`, init, env);

describe('isAllowedBrowserOrigin', () => {
  test('allows same-origin and the dashboard origin, rejects others', () => {
    expect(isAllowedBrowserOrigin(API, `${API}/x`, splitEnv)).toBe(true);
    expect(isAllowedBrowserOrigin(DASH, `${API}/x`, splitEnv)).toBe(true);
    expect(
      isAllowedBrowserOrigin('https://evil.example', `${API}/x`, splitEnv),
    ).toBe(false);
  });

  test('bridge (no dashboard origin) allows only same-origin', () => {
    expect(isAllowedBrowserOrigin(API, `${API}/x`, bridgeEnv)).toBe(true);
    expect(isAllowedBrowserOrigin(DASH, `${API}/x`, bridgeEnv)).toBe(false);
  });

  test('local dev auto-allows the refdlocal.io dashboard, no config', () => {
    const localDash = 'https://dash.refdlocal.io';
    // Keyed off the Origin, so it holds no matter how the request URL is
    // presented behind Caddy (api.refdlocal.io or a bare localhost:port).
    expect(
      isAllowedBrowserOrigin(
        localDash,
        'https://api.refdlocal.io/x',
        bridgeEnv,
      ),
    ).toBe(true);
    expect(
      isAllowedBrowserOrigin(localDash, 'http://localhost:8787/x', bridgeEnv),
    ).toBe(true);
    // The production dashboard origin is not a local origin.
    expect(
      isAllowedBrowserOrigin(DASH, 'https://api.refdlocal.io/x', bridgeEnv),
    ).toBe(false);
  });
});

describe('dashboardCors local dev', () => {
  test.each([
    'https://api.refdlocal.io/x',
    'http://localhost:8787/x', // how wrangler dev may see it behind Caddy
  ])('answers the local dashboard preflight (%s), no config', async (url) => {
    const res = await app().request(
      url,
      { method: 'OPTIONS', headers: { Origin: 'https://dash.refdlocal.io' } },
      bridgeEnv,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://dash.refdlocal.io',
    );
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });
});

describe('dashboardCors', () => {
  test('answers the dashboard-origin preflight with credentialed CORS', async () => {
    const res = await req(
      { method: 'OPTIONS', headers: { Origin: DASH } },
      splitEnv,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(DASH);
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(res.headers.get('Vary')).toContain('Origin');
  });

  test('echoes CORS headers on an actual dashboard-origin request', async () => {
    const res = await req({ headers: { Origin: DASH } }, splitEnv);
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(DASH);
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  test('emits no CORS headers for a foreign or same-origin request', async () => {
    const foreign = await req(
      { headers: { Origin: 'https://evil.example' } },
      splitEnv,
    );
    expect(foreign.headers.get('Access-Control-Allow-Origin')).toBeNull();
    const same = await req({ headers: { Origin: API } }, splitEnv);
    expect(same.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('requireDashboardOrigin', () => {
  test('rejects a mutation from an untrusted origin', async () => {
    const res = await req(
      { method: 'POST', headers: { Origin: 'https://evil.example' } },
      splitEnv,
    );
    expect(res.status).toBe(403);
  });

  test('allows mutations from the dashboard and same origin', async () => {
    expect(
      (await req({ method: 'POST', headers: { Origin: DASH } }, splitEnv))
        .status,
    ).toBe(200);
    expect(
      (await req({ method: 'POST', headers: { Origin: API } }, splitEnv))
        .status,
    ).toBe(200);
  });

  test('allows a mutation with no Origin header', async () => {
    expect((await req({ method: 'POST' }, splitEnv)).status).toBe(200);
  });

  test('does not gate non-mutating methods on origin', async () => {
    expect(
      (await req({ headers: { Origin: 'https://evil.example' } }, splitEnv))
        .status,
    ).toBe(200);
  });
});
