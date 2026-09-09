import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import type { AuthedBindings } from '../auth/middleware';
import type { AppEnv } from '../env';
import type { RunDispatchResult } from '../ingest/dispatch';
import { createOperatorRoutes } from './operator';

const request = async (
  email: string,
  resume: (env: AppEnv, runId: number) => Promise<RunDispatchResult | null>,
  path = '/runs/42/resume-dispatch',
) => {
  const app = new Hono<AuthedBindings>();
  app.use(async (c, next) => {
    c.set('user', {
      id: 1,
      email,
      firstName: null,
      lastName: null,
    });
    await next();
  });
  app.route('/', createOperatorRoutes({ resetAndResumeRunDispatch: resume }));
  return app.request(path, { method: 'POST' }, {
    ADMIN_EMAILS: 'admin@example.com',
  } as AppEnv);
};

const resumed: RunDispatchResult = {
  runId: 42,
  state: 'dispatched',
  cursor: 5,
  attempts: 1,
  expectedMessages: 5,
  nextAttemptAt: null,
};

describe('operator run dispatch recovery', () => {
  test('lets an account-wide operator resume a run', async () => {
    const requestedRunIds: number[] = [];
    const response = await request('admin@example.com', async (_env, runId) => {
      requestedRunIds.push(runId);
      return resumed;
    });

    expect(response.status).toBe(200);
    expect(requestedRunIds).toEqual([42]);
    const body: unknown = await response.json();
    expect(body).toEqual(resumed);
  });

  test('rejects a non-operator before dispatch recovery', async () => {
    let called = false;
    const response = await request('user@example.com', async () => {
      called = true;
      return resumed;
    });

    expect(response.status).toBe(403);
    expect(called).toBe(false);
  });

  test('returns not found for a missing run', async () => {
    const response = await request('admin@example.com', async () => null);
    expect(response.status).toBe(404);
  });

  test('refuses legacy runs without an immutable launch plan', async () => {
    const response = await request('admin@example.com', async () => ({
      ...resumed,
      state: 'legacy',
      expectedMessages: null,
    }));
    expect(response.status).toBe(409);
  });

  test('refuses a malformed persisted launch plan', async () => {
    const response = await request('admin@example.com', async () => ({
      ...resumed,
      state: 'exhausted',
      expectedMessages: null,
    }));
    expect(response.status).toBe(409);
  });

  test('validates the run id before recovery', async () => {
    let called = false;
    const response = await request(
      'admin@example.com',
      async () => {
        called = true;
        return resumed;
      },
      '/runs/not-an-id/resume-dispatch',
    );
    expect(response.status).toBe(400);
    expect(called).toBe(false);
  });
});
