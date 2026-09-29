import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import type { Db } from '../db/client';
import * as schema from '../db/schema';
import { prompts, runs, users, workspaces } from '../db/schema';
import type { AppEnv } from '../env';
import { MIGRATIONS as migrationFiles } from '../lib/test-migrations';
import { createManualRun, previewManualRun } from './runs';

const MIGRATIONS = migrationFiles;

const setup = async (over: { samples?: string } = {}) => {
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
  const env = {
    INGEST: {
      sendBatch: async () => {
        // A preview must not reach the queue, and neither should the assertion
        // below distinguish a dispatched run from an empty one.
      },
    },
    ADMIN_EMAILS: 'owner@example.com',
    SAMPLES: over.samples ?? '1',
    PROMPT_BATCH_SIZE: '5',
  } as unknown as AppEnv;
  await db.insert(users).values({
    email: 'owner@example.com',
    passwordHash: 'hash',
    salt: 'salt',
  });
  const ws = (
    await db
      .insert(workspaces)
      .values({ name: 'ws', ownerUserId: 1, surfaces: ['chatgpt', 'gemini'] })
      .returning({ id: workspaces.id })
  )[0];
  if (!ws) {
    throw new Error('workspace seed failed');
  }
  return { db, env, wsId: ws.id };
};

const seedPrompts = async (db: Db, wsId: number, count: number) => {
  const rows = await db
    .insert(prompts)
    .values(
      Array.from({ length: count }, (_, i) => ({
        workspaceId: wsId,
        text: `prompt number ${i}`,
      })),
    )
    .returning({ id: prompts.id });
  const ids = rows.map((r) => r.id).filter((id): id is number => id != null);
  if (ids.length !== count) {
    throw new Error('prompt seed did not return every id');
  }
  return ids as number[];
};

describe('previewManualRun', () => {
  test('reports the provider spend a run would make, and spends nothing', async () => {
    const { db, env, wsId } = await setup();
    await seedPrompts(db, wsId, 10);
    const before = (await db.select().from(runs))[0];

    const preview = await previewManualRun(db, env, wsId);
    expect(preview.ok).toBeTrue();
    if (!preview.ok) return;
    // 10 prompts x 2 surfaces x 1 sample.
    expect(preview.prompts).toBe(10);
    expect(preview.providerRecords).toBe(20);
    expect(preview.surfaces).toEqual(['chatgpt', 'gemini']);
    expect(preview.samples).toBe(1);
    // Nothing was created, which is the whole point of a preview.
    const after = (await db.select().from(runs))[0];
    expect(after).toBeUndefined();
    expect(before).toBeUndefined();
  });

  test('a preview agrees with the run it previews', async () => {
    // The preview is only useful if it describes the run that actually happens,
    // so it is checked against the created run rather than against arithmetic.
    const { db, env, wsId } = await setup();
    await seedPrompts(db, wsId, 7);
    const preview = await previewManualRun(db, env, wsId, { samples: 2 });
    if (!preview.ok) throw new Error('expected a preview');
    const started = await createManualRun(db, env, wsId, { samples: 2 });
    if (!started.ok) throw new Error('expected a run');
    expect(started.run.totalCount).toBe(preview.providerRecords);
    expect(started.run.dispatchState).toBe('dispatched');
  });

  test('a prompt subset prices only the subset', async () => {
    const { db, env, wsId } = await setup();
    const ids = await seedPrompts(db, wsId, 10);
    const preview = await previewManualRun(db, env, wsId, {
      promptIds: ids.slice(0, 3),
    });
    if (!preview.ok) throw new Error('expected a preview');
    expect(preview.prompts).toBe(3);
    expect(preview.providerRecords).toBe(6);
    expect(preview.excludedPromptIds).toEqual([]);
  });

  test('an inactive or unknown prompt is named rather than silently dropped', async () => {
    // "Run these 12" quietly running 9 is the failure this guards: the caller
    // asked for twelve and would otherwise never learn four were skipped.
    const { db, env, wsId } = await setup();
    const ids = await seedPrompts(db, wsId, 4);
    await db
      .update(prompts)
      .set({ active: false })
      .where(eq(prompts.id, ids[3] as number));
    const preview = await previewManualRun(db, env, wsId, {
      promptIds: [ids[0] as number, ids[1] as number, ids[3] as number, 9999],
    });
    if (!preview.ok) throw new Error('expected a preview');
    expect(preview.prompts).toBe(2);
    expect(preview.excludedPromptIds).toEqual([ids[3] as number, 9999]);
    expect(preview.note).toContain('inactive or unknown');
  });

  test('reports the hourly budget left without consuming it', async () => {
    const { db, env, wsId } = await setup();
    await seedPrompts(db, wsId, 3);
    const first = await previewManualRun(db, env, wsId);
    if (!first.ok) throw new Error('expected a preview');
    expect(first.runsRemainingThisHour).toBe(5);
    expect(first.rateLimited).toBeFalse();
    // A preview does not count against the budget, so previewing twice reports
    // the same number: otherwise the check would cost a run.
    const second = await previewManualRun(db, env, wsId);
    if (!second.ok) throw new Error('expected a preview');
    expect(second.runsRemainingThisHour).toBe(5);

    const started = await createManualRun(db, env, wsId);
    expect(started.ok).toBeTrue();
    const third = await previewManualRun(db, env, wsId);
    if (!third.ok) throw new Error('expected a preview');
    expect(third.runsRemainingThisHour).toBe(4);
  });

  test('an exhausted budget is reported, not enforced', async () => {
    // Reporting is the point: an operator asking what the sixth run would cost
    // deserves an answer, and the real run is what refuses.
    const { db, env, wsId } = await setup();
    await seedPrompts(db, wsId, 2);
    for (let i = 0; i < 5; i += 1) {
      await db.insert(runs).values({
        workspaceId: wsId,
        key: `manual:seed-${i}`,
        date: '2026-09-28',
        trigger: 'manual',
        status: 'dispatched',
        entitySetHash: 'h1',
        createdAt: Date.now(),
      } as never);
    }
    const preview = await previewManualRun(db, env, wsId);
    if (!preview.ok) throw new Error('expected a preview');
    expect(preview.rateLimited).toBeTrue();
    expect(preview.runsRemainingThisHour).toBe(0);
    // The cost is still reported, because that is what was asked for.
    expect(preview.providerRecords).toBe(4);
  });

  test('a workspace with nothing to run says so instead of pricing zero', async () => {
    const { db, env, wsId } = await setup();
    const preview = await previewManualRun(db, env, wsId);
    if (!preview.ok) throw new Error('expected a preview');
    expect(preview.prompts).toBe(0);
    expect(preview.providerRecords).toBe(0);
    expect(preview.note).toContain('spend nothing');
  });

  test('a missing workspace is refused rather than priced against nothing', async () => {
    const { db, env } = await setup();
    const preview = await previewManualRun(db, env, 4242);
    expect(preview.ok).toBeFalse();
    if (preview.ok) return;
    expect(preview.reason).toBe('no-workspace');
  });
});
