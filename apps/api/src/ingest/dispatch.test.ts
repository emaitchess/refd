import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import type { Db } from '../db/client';
import * as schema from '../db/schema';
import {
  prompts,
  type RunDispatchPlan,
  runs,
  users,
  workspaces,
} from '../db/schema';
import type { AppEnv } from '../env';
import {
  resetAndResumeRunDispatchWith,
  resumeRunDispatchWith,
} from './dispatch';
import type { IngestMessage } from './messages';
import { createRunWith } from './runs';

// Migrations applied to an in-memory SQLite so the CAS lease, cursor, and
// backoff updates run as real conditional SQL, not mocks.
const MIGRATIONS = [
  '0000_init.sql',
  '0001_outgoing_sally_floyd.sql',
  '0002_luxuriant_lilandra.sql',
  '0003_tiny_otto_octavius.sql',
  '0004_tearful_killmonger.sql',
  '0005_worried_sinister_six.sql',
  '0006_ancient_wildside.sql',
  '0007_hard_wildside.sql',
];

interface Fixture {
  db: Db;
  env: AppEnv;
  failNext: (batches: number) => void;
  sent: IngestMessage[];
}

const setup = async (adminEmails = ''): Promise<Fixture> => {
  const sqlite = new Database(':memory:');
  for (const file of MIGRATIONS) {
    const raw = await Bun.file(
      new URL(`../../../../drizzle/${file}`, import.meta.url),
    ).text();
    for (const statement of raw.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) {
        sqlite.exec(trimmed);
      }
    }
  }
  sqlite.exec('PRAGMA foreign_keys = ON');
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  const sent: IngestMessage[] = [];
  let failures = 0;
  const env = {
    INGEST: {
      sendBatch: async (batch: { body: IngestMessage }[]) => {
        if (failures > 0) {
          failures -= 1;
          throw new Error('queue unavailable');
        }
        sent.push(...batch.map((message) => message.body));
      },
    },
    ADMIN_EMAILS: adminEmails,
    SAMPLES: '1',
    PROMPT_BATCH_SIZE: '5',
  } as unknown as AppEnv;
  return { db, env, failNext: (batches) => (failures = batches), sent };
};

const seedWorkspace = async (db: Db) => {
  await db.insert(users).values({
    email: 'owner@example.com',
    passwordHash: 'hash',
    salt: 'salt',
  });
  const ws = (
    await db
      .insert(workspaces)
      .values({ name: 'ws', ownerUserId: 1 })
      .returning({ id: workspaces.id })
  )[0];
  if (!ws) {
    throw new Error('workspace seed failed');
  }
  const promptRows = await db
    .insert(prompts)
    .values([
      { workspaceId: ws.id, text: 'first prompt' },
      { workspaceId: ws.id, text: 'second prompt' },
    ])
    .returning({ id: prompts.id });
  return { wsId: ws.id, promptIds: promptRows.map((p) => p.id) };
};

const clearBackoff = async (db: Db, runId: number) => {
  await db
    .update(runs)
    .set({ dispatchNextAttemptAt: Date.now() - 1 })
    .where(eq(runs.id, runId));
};

const dispatchRow = async (db: Db, runId: number) =>
  (await db.select().from(runs).where(eq(runs.id, runId)))[0];

const triggerSurfaces = (sent: IngestMessage[]): string[] =>
  sent.flatMap((m) => (m.kind === 'brightdata_trigger' ? [m.surface] : []));

describe('run dispatch state machine', () => {
  test('a failed queue submission strands the run, and a same-key retry resumes it without a second run', async () => {
    const f = await setup();
    const ws = await seedWorkspace(f.db);
    f.failNext(1);
    const first = await createRunWith(
      f.db,
      f.env,
      ws.wsId,
      'cron',
      'cron:1:2026-09-09',
      '2026-09-09',
    );
    expect(first.created).toBe(true);
    expect(first.dispatchState).toBe('pending');
    expect(first.dispatchAttempts).toBe(1);
    expect(f.sent).toEqual([]);

    const early = await resumeRunDispatchWith(f.db, f.env.INGEST, first.runId);
    expect(early?.state).toBe('pending');
    expect(early?.attempts).toBe(1);
    expect(early?.nextAttemptAt).toBeGreaterThan(Date.now() - 1000);

    await clearBackoff(f.db, first.runId);
    const second = await createRunWith(
      f.db,
      f.env,
      ws.wsId,
      'cron',
      'cron:1:2026-09-09',
      '2026-09-09',
    );
    expect(second.created).toBe(false);
    expect(second.runId).toBe(first.runId);
    expect(second.dispatchState).toBe('dispatched');
    expect(triggerSurfaces(f.sent)).toEqual([
      'chatgpt',
      'perplexity',
      'gemini',
    ]);

    expect(await f.db.select({ id: runs.id }).from(runs)).toHaveLength(1);
  });

  test('bounded attempts exhaust, and the operator reset resumes the same run', async () => {
    const f = await setup();
    const ws = await seedWorkspace(f.db);
    const key = 'cron:1:2026-09-09';
    f.failNext(1);
    const first = await createRunWith(
      f.db,
      f.env,
      ws.wsId,
      'cron',
      key,
      '2026-09-09',
    );
    for (let attempt = 2; attempt <= 3; attempt += 1) {
      await clearBackoff(f.db, first.runId);
      f.failNext(1);
      const next = await createRunWith(
        f.db,
        f.env,
        ws.wsId,
        'cron',
        key,
        '2026-09-09',
      );
      expect(next.dispatchAttempts).toBe(attempt);
    }
    const third = await createRunWith(
      f.db,
      f.env,
      ws.wsId,
      'cron',
      key,
      '2026-09-09',
    );
    expect(third.dispatchState).toBe('exhausted');

    f.failNext(0);
    const stuck = await resumeRunDispatchWith(f.db, f.env.INGEST, first.runId);
    expect(stuck?.state).toBe('exhausted');
    expect(f.sent).toHaveLength(0);

    const reset = await resetAndResumeRunDispatchWith(
      f.db,
      f.env.INGEST,
      first.runId,
    );
    expect(reset?.state).toBe('dispatched');
    expect(reset?.attempts).toBe(1);
    expect(triggerSurfaces(f.sent)).toEqual([
      'chatgpt',
      'perplexity',
      'gemini',
    ]);
    expect(await f.db.select({ id: runs.id }).from(runs)).toHaveLength(1);
  });

  test('a live dispatch lease blocks a second dispatcher until it expires', async () => {
    const f = await setup();
    const ws = await seedWorkspace(f.db);
    f.failNext(1);
    const first = await createRunWith(
      f.db,
      f.env,
      ws.wsId,
      'cron',
      'cron:1:2026-09-09',
      '2026-09-09',
    );
    await f.db
      .update(runs)
      .set({
        dispatchState: 'dispatching',
        dispatchAttempts: 2,
        dispatchLeaseId: 'stale',
        dispatchLeaseUntil: Date.now() + 60_000,
        dispatchNextAttemptAt: null,
      })
      .where(eq(runs.id, first.runId));

    const blocked = await resumeRunDispatchWith(
      f.db,
      f.env.INGEST,
      first.runId,
    );
    expect(blocked?.state).toBe('dispatching');
    expect(blocked?.attempts).toBe(2);
    expect(f.sent).toHaveLength(0);

    await f.db
      .update(runs)
      .set({ dispatchLeaseUntil: Date.now() - 1 })
      .where(eq(runs.id, first.runId));
    const reclaimed = await resumeRunDispatchWith(
      f.db,
      f.env.INGEST,
      first.runId,
    );
    expect(reclaimed?.state).toBe('dispatched');
    expect(reclaimed?.attempts).toBe(3);
    expect(f.sent).toHaveLength(3);
  });

  test('legacy rows are never reconstructed from mutable state', async () => {
    const f = await setup();
    const ws = await seedWorkspace(f.db);
    const inserted = (
      await f.db
        .insert(runs)
        .values({
          workspaceId: ws.wsId,
          key: 'legacy:1',
          date: '2026-09-09',
          trigger: 'import',
          totalCount: 5,
        })
        .returning({ id: runs.id })
    )[0];
    if (!inserted) {
      throw new Error('legacy run seed failed');
    }

    const result = await resumeRunDispatchWith(f.db, f.env.INGEST, inserted.id);
    expect(result?.state).toBe('legacy');
    expect(result?.expectedMessages).toBeNull();
    expect(f.sent).toHaveLength(0);

    const reset = await resetAndResumeRunDispatchWith(
      f.db,
      f.env.INGEST,
      inserted.id,
    );
    expect(reset?.state).toBe('legacy');
    expect(f.sent).toHaveLength(0);
  });

  test('an invalid persisted plan records the error and spends nothing', async () => {
    const f = await setup();
    const ws = await seedWorkspace(f.db);
    f.failNext(1);
    const first = await createRunWith(
      f.db,
      f.env,
      ws.wsId,
      'cron',
      'cron:1:2026-09-09',
      '2026-09-09',
    );
    await f.db
      .update(runs)
      .set({ dispatchPlan: { version: 1 } as unknown as RunDispatchPlan })
      .where(eq(runs.id, first.runId));
    await clearBackoff(f.db, first.runId);

    const resumed = await resumeRunDispatchWith(
      f.db,
      f.env.INGEST,
      first.runId,
    );
    expect(resumed?.state).toBe('pending');
    expect(resumed?.attempts).toBe(2);
    expect(f.sent).toHaveLength(0);
    expect((await dispatchRow(f.db, first.runId))?.dispatchLastError).toContain(
      'invalid persisted dispatch plan',
    );
  });

  test('operator entitlement fans aio out through the real creation path', async () => {
    const f = await setup('owner@example.com');
    const ws = await seedWorkspace(f.db);
    const created = await createRunWith(
      f.db,
      f.env,
      ws.wsId,
      'cron',
      'cron:1:2026-09-09',
      '2026-09-09',
    );
    expect(created.dispatchState).toBe('dispatched');
    expect(created.totalCount).toBe(10);
    expect(f.sent.filter((m) => m.kind === 'brightdata_trigger')).toHaveLength(
      4,
    );
    expect(f.sent.filter((m) => m.kind === 'serp_aio_fetch')).toHaveLength(2);
  });
});
