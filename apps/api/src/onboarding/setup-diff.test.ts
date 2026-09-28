import { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import type { Db } from '../db/client';
import * as schema from '../db/schema';
import { entities, prompts, users, workspaces } from '../db/schema';
import { MIGRATIONS as migrationFiles } from '../lib/test-migrations';
import { promptPlanDiff } from './service';

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
  await db.insert(entities).values({
    id: 50,
    workspaceId: 9,
    name: 'mrmr',
    domains: ['getmrmr.com'],
    aliases: [],
    isBrand: true,
    sortOrder: 0,
  });
  // Defaults to the same category the draft helper uses, so a seeded prompt
  // counts as untouched rather than as a pending category change.
  const live = async (id: number, text: string, category = 'Discovery') => {
    await db
      .insert(prompts)
      .values({ id, workspaceId: 9, text, tags: [category] });
  };
  return { db, live, workspaceId: 9 };
};

const draft = (...texts: string[]) =>
  texts.map((t) => ({ text: t, category: 'Discovery' }));

describe('promptPlanDiff', () => {
  test('merge never retires: a shorter submission leaves the live set alone', async () => {
    const { db, live, workspaceId } = await setup();
    await live(1, 'question one?');
    await live(2, 'question two?');
    const diff = await promptPlanDiff(
      db,
      workspaceId,
      draft('question one?'),
      'merge',
    );
    expect(diff.retired).toEqual([]);
    expect(diff.added).toEqual([]);
    expect(diff.untouched).toEqual(['question one?']);
    expect(diff.liveActive).toBe(2);
  });

  // The reported bug: a 32-prompt submission left 35 live. Under replace the
  // submitted list is the set, and the three omissions are named before commit.
  test('replace names exactly the prompts that will stop being measured', async () => {
    const { db, live, workspaceId } = await setup();
    await live(1, 'question one?');
    await live(2, 'question two?');
    await live(3, 'question three?');
    const diff = await promptPlanDiff(
      db,
      workspaceId,
      draft('question one?', 'question two?'),
      'replace',
    );
    expect(diff.retired).toEqual(['question three?']);
    expect(diff.untouched.sort()).toEqual(['question one?', 'question two?']);
    expect(diff.liveActive).toBe(3);
  });

  test('a category change is an update, not an add and a retire', async () => {
    const { db, live, workspaceId } = await setup();
    await live(1, 'question one?', 'Discovery');
    const diff = await promptPlanDiff(
      db,
      workspaceId,
      [{ text: 'question one?', category: 'Comparison' }],
      'replace',
    );
    expect(diff.updated).toEqual([
      { text: 'question one?', from: 'Discovery', to: 'Comparison' },
    ]);
    expect(diff.added).toEqual([]);
    expect(diff.retired).toEqual([]);
  });

  test('a retired prompt is not proposed for retirement again', async () => {
    const { db, live, workspaceId } = await setup();
    await live(1, 'question one?');
    await live(2, 'question two?');
    await db
      .update(prompts)
      .set({ active: false, retiredBy: 'setup-sync' })
      .where(eq(prompts.id, 2));
    const diff = await promptPlanDiff(
      db,
      workspaceId,
      draft('question one?'),
      'replace',
    );
    expect(diff.retired).toEqual([]);
    expect(diff.liveActive).toBe(1);
  });
});

describe('retirement marker', () => {
  let db: Db;
  beforeEach(async () => {
    ({ db } = await setup());
  });

  test('a prompt retired by a setup sync is distinguishable from a manual retire', async () => {
    await db.insert(prompts).values({
      id: 1,
      workspaceId: 9,
      text: 'question one?',
      tags: ['Discovery'],
    });
    await db
      .update(prompts)
      .set({ active: false, retiredBy: 'setup-sync' })
      .where(eq(prompts.id, 1));
    const rows = await db
      .select({ active: prompts.active, retiredBy: prompts.retiredBy })
      .from(prompts)
      .where(and(eq(prompts.workspaceId, 9), eq(prompts.id, 1)));
    expect(rows[0]).toEqual({ active: false, retiredBy: 'setup-sync' });
  });
});
