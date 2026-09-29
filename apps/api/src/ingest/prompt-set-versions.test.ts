import { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import type { Db } from '../db/client';
import * as schema from '../db/schema';
import { promptSetVersions, runs, users, workspaces } from '../db/schema';
import { MIGRATIONS as migrationFiles } from '../lib/test-migrations';
import {
  backfillPromptSetVersions,
  ensurePromptSetHistory,
  promptSetTimeline,
  resolvePromptSetVersion,
} from './prompt-set-versions';
import { promptSetHash } from './runs';

const MIGRATIONS = migrationFiles;

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
  p?: unknown,
) => {
  await db.insert(runs).values({
    id,
    workspaceId: 9,
    key: `cron:9:${date}:${id}`,
    date,
    trigger: 'cron',
    status: 'complete',
    entitySetHash: 'h1',
    promptSetVersionId: versionId,
    // A historical run carries the frozen plan it measured, which is the only
    // place its population can be read from.
    dispatchPlan: p as never,
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

describe('backfillPromptSetVersions', () => {
  let db: Db;
  let workspaceId: number;
  beforeEach(async () => {
    ({ db, workspaceId } = await setup());
  });

  // The reported failure: four runs over three populations existed, and the
  // timeline returned only the newest, labelled as the first.
  test('a history recorded before the feature is recovered, oldest first', async () => {
    const ids = Array.from({ length: 25 }, (_, i) => i + 1);
    const added10 = Array.from({ length: 10 }, (_, i) => 900 + i);
    const added21 = Array.from({ length: 21 }, (_, i) => 133 + i);
    // 25 prompts, then 25 (a second run on the same population), then 35, then
    // 56: the three populations the report found already in the run history.
    const p25 = plan(...ids);
    const p35 = plan(...ids.slice(0, 25), ...added10);
    const p56 = plan(...ids, ...added10, ...added21.slice(0, 11));
    await seedRun(db, 90, '2026-09-25', null, p25);
    await seedRun(db, 93, '2026-09-26', null, p25);
    await seedRun(db, 96, '2026-09-27', null, p35);
    await seedRun(db, 98, '2026-09-27', null, p56);

    const result = await backfillPromptSetVersions(db, workspaceId);
    expect(result.minted).toBe(3);
    expect(result.runsLinked).toBe(4);

    const timeline = await promptSetTimeline(db, workspaceId);
    expect(timeline).toHaveLength(3);
    expect(timeline.map((v) => v.firstRunDate)).toEqual([
      '2026-09-25',
      '2026-09-27',
      '2026-09-27',
    ]);
    // Ordered by first run, so the 25-prompt population is genuinely first.
    expect(timeline[0]?.prompts).toBe(25);
    expect(timeline[1]?.prompts).toBe(35);
    expect(timeline[2]?.prompts).toBe(46);
    // Each version's change is described against the population before it in
    // time, not against whatever was inserted last.
    expect(timeline[0]?.changeReason).toBe(
      'first recorded population for this workspace',
    );
    expect(timeline[1]?.changeReason).toBe(
      '10 added against the previous population',
    );
    expect(timeline[2]?.changeReason).toBe(
      '11 added against the previous population',
    );
    // Every historical run is attributed to the population it measured.
    expect(timeline.map((v) => v.runs)).toEqual([2, 1, 1]);
  });

  test('the first run date is the first run on that population, not the first that pointed at the version', async () => {
    // Run 98 carried the newest population a day before the run that minted the
    // version for it, so matching only on versionId reported the wrong date.
    const ids = Array.from({ length: 56 }, (_, i) => i + 1);
    const version = await resolve(db, workspaceId, plan(...ids));
    await seedRun(db, 98, '2026-09-27', null, plan(...ids));
    await seedRun(db, 101, '2026-09-28', version.id, plan(...ids));

    const timeline = await promptSetTimeline(db, workspaceId);
    expect(timeline[0]?.firstRunId).toBe(98);
    expect(timeline[0]?.firstRunDate).toBe('2026-09-27');
    expect(timeline[0]?.runs).toBe(2);
  });

  test('is idempotent', async () => {
    const ids = Array.from({ length: 5 }, (_, i) => i + 1);
    await seedRun(db, 1, '2026-09-25', null, plan(...ids));
    const first = await backfillPromptSetVersions(db, workspaceId);
    expect(first.minted).toBe(1);
    const second = await backfillPromptSetVersions(db, workspaceId);
    expect(second.minted).toBe(0);
    expect(second.runsLinked).toBe(0);
    expect(await promptSetTimeline(db, workspaceId)).toHaveLength(1);
  });

  test('a run with no frozen plan measures nothing and mints no version', async () => {
    await seedRun(db, 1, '2026-09-25', null, undefined);
    const result = await backfillPromptSetVersions(db, workspaceId);
    expect(result.minted).toBe(0);
    expect(await promptSetTimeline(db, workspaceId)).toHaveLength(0);
  });

  test('only one workspace is touched', async () => {
    const ids = Array.from({ length: 3 }, (_, i) => i + 1);
    await seedRun(db, 1, '2026-09-25', null, plan(...ids));
    await db
      .insert(workspaces)
      .values({ id: 10, name: 'other', ownerUserId: 1 });
    await db.insert(runs).values({
      id: 2,
      workspaceId: 10,
      key: 'cron:10:2026-09-25',
      date: '2026-09-25',
      trigger: 'cron',
      status: 'complete',
      entitySetHash: 'h1',
      promptSetVersionId: null,
      dispatchPlan: plan(...ids) as never,
    } as typeof runs.$inferInsert);

    await backfillPromptSetVersions(db, workspaceId);
    const other = await promptSetTimeline(db, 10);
    expect(other).toHaveLength(0);
  });

  test('ensurePromptSetHistory is the same operation', async () => {
    const ids = Array.from({ length: 4 }, (_, i) => i + 1);
    await seedRun(db, 1, '2026-09-25', null, plan(...ids));
    expect((await ensurePromptSetHistory(db, workspaceId)).minted).toBe(1);
  });
});
