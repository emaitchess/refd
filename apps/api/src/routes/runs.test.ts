import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import type { WorkspaceBindings } from '../auth/middleware';
import type { AppEnv } from '../env';
import { runRoutes } from './runs';

const migratedDb = () => {
  const db = new Database(':memory:');
  const migrationsDir = join(import.meta.dir, '../../../../drizzle');
  for (const file of readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
  }
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    insert into users (id, email, password_hash, salt)
    values (1, 'owner@example.com', 'hash', 'salt');
    insert into workspaces (id, owner_user_id, name) values (1, 1, 'Mine');
    insert into workspaces (id, owner_user_id, name) values (2, 1, 'Theirs');
    insert into runs (id, workspace_id, key, date, trigger, status, ok_count, total_count)
    values (1, 1, 'cron:1:2026-09-01', '2026-09-01', 'cron', 'complete', 5, 5);
    insert into runs (id, workspace_id, key, date, trigger, status, ok_count, total_count)
    values (2, 1, 'cron:1:2026-09-02', '2026-09-02', 'cron', 'running', 1, 5);
    insert into runs (id, workspace_id, key, date, trigger, status, ok_count, total_count)
    values (3, 2, 'cron:2:2026-09-03', '2026-09-03', 'cron', 'complete', 5, 5);
  `);
  return db;
};

const d1Env = (sqlite: Database): AppEnv =>
  ({
    DB: {
      prepare: (query: string) => ({
        bind: (...params: unknown[]) => {
          const statement = sqlite.prepare(query);
          const all = statement.all.bind(statement) as (
            ...values: unknown[]
          ) => Record<string, unknown>[];
          const run = statement.run.bind(statement) as (
            ...values: unknown[]
          ) => unknown;
          return {
            all: async () => ({ results: all(...params) }),
            first: async () => all(...params)[0] ?? null,
            run: async () => run(...params),
            raw: async () => all(...params).map((row) => Object.values(row)),
            execute: () => run(...params),
          };
        },
      }),
      batch: async () => [],
    },
  }) as unknown as AppEnv;

const listRuns = async (workspaceId: number) => {
  const app = new Hono<WorkspaceBindings>();
  app.use('*', async (c, next) => {
    c.set('user', {
      id: 1,
      email: 'owner@example.com',
      firstName: null,
      lastName: null,
    });
    c.set('workspace', { id: workspaceId, name: 'Workspace' });
    await next();
  });
  app.route('/', runRoutes);
  return app.request('/', {}, d1Env(migratedDb()));
};

describe('run history', () => {
  test("returns the workspace's runs newest first", async () => {
    const response = await listRuns(1);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { runs: { id: number }[] };
    expect(body.runs.map((run) => run.id)).toEqual([2, 1]);
  });

  test("never lists another workspace's runs", async () => {
    const response = await listRuns(2);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { runs: { id: number }[] };
    expect(body.runs.map((run) => run.id)).toEqual([3]);
  });
});
