import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import type { Db } from '../db/client';
import * as schema from '../db/schema';
import { prompts, runs, snapshots, users, workspaces } from '../db/schema';
import { isQueueOverload, resumeTerminalSnapshot } from './consumer';

// Migrations applied to an in-memory SQLite so the terminal-snapshot reset
// runs as real conditional SQL, not mocks.
const MIGRATIONS = [
  '0000_init.sql',
  '0001_outgoing_sally_floyd.sql',
  '0002_luxuriant_lilandra.sql',
  '0003_tiny_otto_octavius.sql',
  '0004_tearful_killmonger.sql',
  '0005_worried_sinister_six.sql',
  '0006_ancient_wildside.sql',
  '0007_dazzling_prima.sql',
  '0008_tricky_war_machine.sql',
  '0009_amazing_hydra.sql',
  '0010_nostalgic_swarm.sql',
];

const setup = async (): Promise<Db> => {
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
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  await db.insert(users).values({
    id: 1,
    email: 'owner@example.com',
    passwordHash: 'x',
    salt: 'x',
  });
  await db.insert(workspaces).values({ id: 9, name: 'ws', ownerUserId: 1 });
  await db.insert(runs).values({
    id: 60,
    workspaceId: 9,
    key: 'cron:9:2026-09-15',
    date: '2026-09-15',
    trigger: 'cron',
    status: 'complete',
  });
  await db.insert(prompts).values([
    { id: 86, workspaceId: 9, text: 'p86' },
    { id: 87, workspaceId: 9, text: 'p87' },
  ]);
  return db;
};

const insertSnapshot = async (db: Db): Promise<number> => {
  const rows = await db
    .insert(snapshots)
    .values({
      runId: 60,
      provider: 'brightdata',
      surface: 'google_ai_mode',
      sample: 1,
      chunk: 3,
      promptIds: [86, 87],
      promptSnapshot: [
        { id: 86, text: 'p86' },
        { id: 87, text: 'p87' },
      ],
      externalId: 'sd_existing',
    })
    .returning({ id: snapshots.id });
  return rows[0]?.id ?? 0;
};

const snapshotOf = async (db: Db) =>
  (await db.select().from(snapshots).where(eq(snapshots.runId, 60)))[0];

describe('isQueueOverload', () => {
  test('matches the Cloudflare Queues backpressure error', () => {
    expect(
      isQueueOverload(
        new Error('Queue is overloaded. Please back off. (10250)'),
      ),
    ).toBe(true);
  });

  test('does not match provider or transport failures', () => {
    expect(
      isQueueOverload(
        new Error(
          'brightdata 400 on trigger perplexity: Customer is not active',
        ),
      ),
    ).toBe(false);
    expect(isQueueOverload(new Error('Network connection lost.'))).toBe(false);
  });

  test('tolerates a non-Error throw', () => {
    expect(isQueueOverload('Queue is overloaded')).toBe(true);
    expect(isQueueOverload(undefined)).toBe(false);
  });
});

describe('resumeTerminalSnapshot', () => {
  test('resets a failed snapshot so a recover re-trigger can resume the fetch', async () => {
    const db = await setup();
    const id = await insertSnapshot(db);
    await db
      .update(snapshots)
      .set({ status: 'failed', finishedAt: 1757917387000, polls: 0 })
      .where(eq(snapshots.id, id));

    await resumeTerminalSnapshot(db, id);

    const row = await snapshotOf(db);
    expect(row?.status).toBe('triggered');
    expect(row?.finishedAt).toBeNull();
    expect(row?.externalId).toBe('sd_existing');
    expect(row?.promptSnapshot).toHaveLength(2);
  });

  test('resets a ready snapshot with missing results the same way', async () => {
    const db = await setup();
    const id = await insertSnapshot(db);
    await db
      .update(snapshots)
      .set({ status: 'ready', finishedAt: 1757917387000 })
      .where(eq(snapshots.id, id));

    await resumeTerminalSnapshot(db, id);

    const row = await snapshotOf(db);
    expect(row?.status).toBe('triggered');
    expect(row?.finishedAt).toBeNull();
  });

  test('leaves an in-flight triggered snapshot untouched', async () => {
    const db = await setup();
    const id = await insertSnapshot(db);

    await resumeTerminalSnapshot(db, id);

    const row = await snapshotOf(db);
    expect(row?.status).toBe('triggered');
    expect(row?.finishedAt).toBeNull();
  });
});
