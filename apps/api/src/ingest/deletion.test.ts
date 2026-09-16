import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import type { AppEnv } from '../env';
import {
  cleanRawObject,
  clearRawCleanup,
  deleteRunRawObjects,
  processRawCleanupTasks,
  RawWriteBusyError,
  registerRawWrite,
} from './deletion';

const cleanupEnv = (deleteObject: (key: string) => Promise<void>) => {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    create table raw_cleanup_tasks (
      key text primary key not null,
      available_at integer not null,
      token text,
      lease_expires_at integer,
      attempts integer default 0 not null,
      last_error text,
      created_at integer default (unixepoch() * 1000) not null
    );
    create table users (id integer primary key, deleting_at integer);
    create table workspaces (
      id integer primary key,
      owner_user_id integer not null,
      deleting_at integer
    );
    create table runs (id integer primary key, workspace_id integer not null);
    create table results (id integer primary key, run_id integer, r2_key text);
  `);
  const d1 = {
    prepare: (query: string) => {
      const statement = sqlite.prepare(query);
      const all = statement.all.bind(statement) as (
        ...params: unknown[]
      ) => Record<string, unknown>[];
      const run = statement.run.bind(statement) as (...params: unknown[]) => {
        changes: number;
      };
      return {
        bind: (...params: unknown[]) => ({
          all: async () => ({ results: all(...params) }),
          first: async () => all(...params)[0] ?? null,
          run: async () => ({
            success: true,
            meta: { changes: run(...params).changes },
          }),
        }),
      };
    },
  };
  return {
    sqlite,
    env: {
      DB: d1,
      RAW: { delete: deleteObject },
    } as unknown as AppEnv,
  };
};

describe('deleteRunRawObjects', () => {
  test('deletes known keys and every paginated object under each run prefix', async () => {
    const deleted: string[][] = [];
    const env = {
      RAW: {
        list: async ({
          prefix,
          cursor,
        }: {
          prefix: string;
          cursor?: string;
        }) =>
          cursor
            ? {
                objects: [{ key: `${prefix}second.json.gz` }],
                truncated: false,
              }
            : {
                objects: [{ key: `${prefix}first.json.gz` }],
                truncated: true,
                cursor: 'next',
              },
        delete: async (keys: string[]) => {
          deleted.push(keys);
        },
      },
    } as unknown as AppEnv;

    await deleteRunRawObjects(env, [7], ['legacy/key.json.gz', null]);

    expect(deleted.flat().sort()).toEqual([
      'legacy/key.json.gz',
      'raw/7/first.json.gz',
      'raw/7/second.json.gz',
    ]);
  });
});

describe('raw cleanup leases', () => {
  test('a stale owner cannot delete an object after a newer writer takes over', async () => {
    const deleted: string[] = [];
    const { env, sqlite } = cleanupEnv(async (key) => {
      deleted.push(key);
    });
    const first = await registerRawWrite(env, 'raw/1/result.json.gz');
    await expect(
      registerRawWrite(env, 'raw/1/result.json.gz'),
    ).rejects.toBeInstanceOf(RawWriteBusyError);

    sqlite.query('update raw_cleanup_tasks set lease_expires_at = 0').run();
    const second = await registerRawWrite(env, 'raw/1/result.json.gz');

    expect(await cleanRawObject(env, 'raw/1/result.json.gz', first)).toBe(
      false,
    );
    expect(deleted).toEqual([]);
    expect(await cleanRawObject(env, 'raw/1/result.json.gz', second)).toBe(
      true,
    );
    expect(deleted).toEqual(['raw/1/result.json.gz']);
  });

  test('keeps referenced objects and deletes stale unreferenced objects', async () => {
    const deleted: string[] = [];
    const { env, sqlite } = cleanupEnv(async (key) => {
      deleted.push(key);
    });
    const activeKey = 'raw/1/active.json.gz';
    const staleKey = 'raw/2/stale.json.gz';
    await registerRawWrite(env, activeKey);
    await registerRawWrite(env, staleKey);
    sqlite.exec(`
      update raw_cleanup_tasks set available_at = 0, lease_expires_at = 0;
      insert into users (id) values (1);
      insert into workspaces (id, owner_user_id) values (1, 1);
      insert into runs (id, workspace_id) values (1, 1);
      insert into results (id, run_id, r2_key) values (1, 1, '${activeKey}');
    `);

    expect(await processRawCleanupTasks(env)).toBe(1);
    expect(deleted).toEqual([staleKey]);
    expect(sqlite.query('select key from raw_cleanup_tasks').all()).toEqual([]);
  });

  test('releases a failed cleanup for retry without losing its history', async () => {
    const { env, sqlite } = cleanupEnv(async () => {
      throw new Error('R2 unavailable');
    });
    const key = 'raw/1/retry.json.gz';
    await registerRawWrite(env, key);
    sqlite
      .query(
        'update raw_cleanup_tasks set available_at = 0, lease_expires_at = 0',
      )
      .run();

    expect(await processRawCleanupTasks(env)).toBe(0);
    expect(
      sqlite
        .query(
          `select attempts, last_error, token, lease_expires_at
           from raw_cleanup_tasks where key = ?`,
        )
        .get(key),
    ).toEqual({
      attempts: 1,
      last_error: 'Error: R2 unavailable',
      token: null,
      lease_expires_at: null,
    });
  });

  test('only the current token can clear a task', async () => {
    const { env, sqlite } = cleanupEnv(async () => undefined);
    const key = 'raw/1/current.json.gz';
    const token = await registerRawWrite(env, key);

    await clearRawCleanup(env, key, 'stale-token');
    expect(
      sqlite.query('select key from raw_cleanup_tasks where key = ?').get(key),
    ).toEqual({ key });
    await clearRawCleanup(env, key, token);
    expect(
      sqlite.query('select key from raw_cleanup_tasks where key = ?').get(key),
    ).toBeNull();
  });
});
