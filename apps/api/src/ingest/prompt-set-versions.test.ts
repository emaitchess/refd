import { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import type { Db } from '../db/client';
import * as schema from '../db/schema';
import { promptSetVersions, runs, users, workspaces } from '../db/schema';
import {
  promptSetTimeline,
  resolvePromptSetVersion,
} from './prompt-set-versions';
import { promptSetHash } from './runs';

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
  '0011_spotty_hairball.sql',
  '0012_youthful_yellow_claw.sql',
  '0013_skinny_mindworm.sql',
  '0014_calm_tomorrow_man.sql',
  '0015_true_the_phantom.sql',
  '0016_careless_queen_noir.sql',
  '0017_chief_maelstrom.sql',
  '0018_prompt_cohort_taxonomy.sql',
  '0019_flat_energizer.sql',
  '0020_yummy_reaper.sql',
];

const setup = async () => {
  const sqlite = new Database(':memory:');
  for (const file of MIGRATIONS) {
    const raw = await Bun.file(
      new URL(`../../../../drizzle/${file}`, import.meta.url),
    ).text();
    for (const statement of raw.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed.length > 0) {
        sqlite.exec(trimmed);
      }
    }
  }
  sqlite.exec('PRAGMA foreign_keys = ON');
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  await db.insert(users).values({
    id: 1,
    email: 'owner@example.com',
    passwordHash: 'x',
    salt: 'x',
  });
  await db.insert(workspaces).values({ id: 9, name: 'ws', ownerUserId: 1 });
  return { db, workspaceId: 9 };
};

const plan = (...ids: number[]) => ({
  prompts: ids.map((id) => ({ id, text: `prompt ${id}?` })),
  samples: 1,
});

const resolve = (
  db: Db,
  workspaceId: number,
  p: unknown,
  surfaces = ['chatgpt'],
) => resolvePromptSetVersion(db, workspaceId, p, promptSetHash(p), surfaces);

const seedRun = async (
  db: Db,
  id: number,
  date: string,
  versionId: number | null,
) => {
  await db.insert(runs).values({
    id,
    workspaceId: 9,
    key: `cron:9:${date}`,
    date,
    trigger: 'cron',
    status: 'complete',
    entitySetHash: 'h1',
    promptSetVersionId: versionId,
  } as typeof runs.$inferInsert);
};

describe('resolvePromptSetVersion', () => {
  let db: Db;
  let workspaceId: number;
  beforeEach(async () => {
    ({ db, workspaceId } = await setup());
  });

  // The property the whole feature rests on: identical questions, identical
  // version, which is what makes two runs comparable at all.
  test('the same population resolves to the same version', async () => {
    const first = await resolve(db, workspaceId, plan(1, 2, 3));
    const second = await resolve(db, workspaceId, plan(1, 2, 3));
    expect(first.id).not.toBeNull();
    expect(second.id).toBe(first.id);
    expect(first.hash).toBe(second.hash);
  });

  test('order does not make a new version, since the set is the identity', async () => {
    const first = await resolve(db, workspaceId, plan(1, 2, 3));
    const reordered = await resolve(db, workspaceId, plan(3, 2, 1));
    expect(reordered.id).toBe(first.id);
  });

  test('a different population mints a new version', async () => {
    const first = await resolve(db, workspaceId, plan(1, 2, 3));
    const second = await resolve(db, workspaceId, plan(1, 2, 3, 4));
    const third = await resolve(db, workspaceId, plan(1, 2));
    expect(new Set([first.id, second.id, third.id]).size).toBe(3);
  });

  test('a change reason reads as a delta against the previous population', async () => {
    const first = await resolve(db, workspaceId, plan(1, 2, 3));
    expect(first.changeReason).toBe(
      'first recorded population for this workspace',
    );
    const second = await resolve(db, workspaceId, plan(1, 2, 3, 4));
    expect(second.changeReason).toBe('1 added against the previous population');
    // plan(1,2,3,4) -> plan(1,2) drops two questions, not one.
    const third = await resolve(db, workspaceId, plan(1, 2));
    expect(third.changeReason).toBe(
      '2 removed against the previous population',
    );
    const fourth = await resolve(db, workspaceId, plan(9, 10));
    expect(fourth.changeReason).toBe(
      '2 added, 2 removed against the previous population',
    );
  });

  // A version that claims to describe a population nobody recorded would make
  // the timeline lie, so a plan with no prompts resolves to nothing.
  test('a plan with no prompts mints no version', async () => {
    expect((await resolve(db, workspaceId, null)).id).toBeNull();
    expect((await resolve(db, workspaceId, {})).id).toBeNull();
    expect((await resolve(db, workspaceId, { prompts: [] })).id).toBeNull();
    expect(await db.select().from(promptSetVersions)).toHaveLength(0);
  });

  test('a surface change does not mint a prompt version', async () => {
    const first = await resolve(db, workspaceId, plan(1, 2), ['chatgpt']);
    const moreSurfaces = await resolve(db, workspaceId, plan(1, 2), [
      'chatgpt',
      'perplexity',
    ]);
    expect(moreSurfaces.id).toBe(first.id);
  });

  test('versions are scoped per workspace', async () => {
    await db
      .insert(workspaces)
      .values({ id: 10, name: 'other', ownerUserId: 1 });
    const mine = await resolve(db, 9, plan(1, 2));
    const theirs = await resolve(db, 10, plan(1, 2));
    expect(theirs.id).not.toBe(mine.id);
  });
});

describe('promptSetTimeline', () => {
  let db: Db;
  let workspaceId: number;
  beforeEach(async () => {
    ({ db, workspaceId } = await setup());
  });

  test('is empty before anything is measured', async () => {
    expect(await promptSetTimeline(db, workspaceId)).toEqual([]);
  });

  test('orders versions by first run and counts what was collected', async () => {
    const older = await resolve(db, workspaceId, plan(1, 2));
    const newer = await resolve(db, workspaceId, plan(1, 2, 3));
    await seedRun(db, 2, '2026-08-20', newer.id);
    await seedRun(db, 1, '2026-08-10', older.id);
    await seedRun(db, 3, '2026-08-21', newer.id);

    const timeline = await promptSetTimeline(db, workspaceId);
    const ids = (await Promise.all([older, newer])).map((v) => v.id ?? 0);
    expect(ids.every((id) => id > 0)).toBe(true);
    expect(timeline.map((v) => v.versionId)).toEqual(ids);
    expect(timeline[0]).toMatchObject({
      prompts: 2,
      firstRunDate: '2026-08-10',
      runs: 1,
      changeReason: 'first recorded population for this workspace',
    });
    expect(timeline[1]).toMatchObject({
      prompts: 3,
      firstRunDate: '2026-08-20',
      runs: 2,
      changeReason: '1 added against the previous population',
    });
  });

  // A version is a record of what was measured, so one that never ran sorts
  // last rather than pretending to be the oldest thing collected.
  test('a minted but unrun version sorts last', async () => {
    const ran = await resolve(db, workspaceId, plan(1, 2));
    const neverRan = await resolve(db, workspaceId, plan(9));
    await seedRun(db, 1, '2026-08-10', ran.id);
    const timeline = await promptSetTimeline(db, workspaceId);
    const ids = [ran.id ?? 0, neverRan.id ?? 0];
    expect(ids.every((id) => id > 0)).toBe(true);
    expect(timeline.map((v) => v.versionId)).toEqual(ids);
    expect(timeline[1]).toMatchObject({ firstRunDate: null, runs: 0 });
  });

  test('a run with no version predates versioning and is not attributed', async () => {
    const version = await resolve(db, workspaceId, plan(1, 2));
    await seedRun(db, 1, '2026-08-10', null);
    await seedRun(db, 2, '2026-08-11', version.id);
    const timeline = await promptSetTimeline(db, workspaceId);
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({ runs: 1, firstRunDate: '2026-08-11' });
  });

  test('only the workspace versions are listed', async () => {
    await db
      .insert(workspaces)
      .values({ id: 10, name: 'other', ownerUserId: 1 });
    await resolve(db, 9, plan(1));
    await resolve(db, 10, plan(1, 2));
    expect(await promptSetTimeline(db, 9)).toHaveLength(1);
  });
});
