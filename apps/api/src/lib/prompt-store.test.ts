import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import type { Db } from '../db/client';
import * as schema from '../db/schema';
import { prompts, results, runs, users, workspaces } from '../db/schema';
import type { AppEnv } from '../env';
import {
  createPrompt,
  promptUsageCounts,
  removePrompt,
  setPromptActive,
  updatePromptFields,
} from './prompt-store';

// Migrations applied to an in-memory SQLite so the bounded activation SQL
// runs as real conditional updates, not mocks.
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
  '0019_flat_energizer.sql',
];

const makeD1 = (sqlite: Database) => ({
  prepare: (query: string) => {
    const stmt = sqlite.prepare(query);
    const all = stmt.all.bind(stmt) as (
      ...params: unknown[]
    ) => Record<string, unknown>[];
    const runStmt = stmt.run.bind(stmt) as (...params: unknown[]) => void;
    return {
      bind: (...params: unknown[]) => ({
        all: async () => ({ results: all(...params) }),
        first: async () => all(...params)[0] ?? null,
        // run must execute: without it, updates through the D1 driver
        // (getDb) silently no-op and the tests lie.
        run: async () => {
          runStmt(...params);
          return { success: true, meta: {} };
        },
        raw: async () => all(...params).map((row) => Object.values(row)),
      }),
    };
  },
});

interface Fixture {
  db: Db;
  env: AppEnv;
  workspaceId: number;
}

const setup = async (): Promise<Fixture> => {
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
  const env = { DB: makeD1(sqlite) } as unknown as AppEnv;
  await db.insert(users).values({
    id: 1,
    email: 'owner@example.com',
    passwordHash: 'x',
    salt: 'x',
  });
  const ws = (
    await db
      .insert(workspaces)
      .values({ id: 9, name: 'ws', ownerUserId: 1 })
      .returning({ id: workspaces.id })
  )[0];
  if (!ws) {
    throw new Error('workspace seed failed');
  }
  return { db, env, workspaceId: ws.id };
};

const seedPrompt = async (
  db: Db,
  workspaceId: number,
  text: string,
  tags: string[] = [],
  active = true,
) =>
  (
    await db
      .insert(prompts)
      .values({ workspaceId, text, tags, active })
      .returning({ id: prompts.id })
  )[0]?.id as number;

const seedHistory = async (db: Db, workspaceId: number, promptId: number) => {
  const run = (
    await db
      .insert(runs)
      .values({
        workspaceId,
        key: `manual:${promptId}`,
        date: '2026-09-25',
        trigger: 'manual',
        status: 'complete',
      })
      .returning({ id: runs.id })
  )[0];
  if (!run) {
    throw new Error('run seed failed');
  }
  await db.insert(results).values({
    runId: run.id,
    promptId,
    surface: 'chatgpt',
    sample: 1,
    provider: 'brightdata',
    ok: true,
  });
};

describe('createPrompt', () => {
  test('inserts and returns the row; a same-text insert converges to it', async () => {
    const { env, workspaceId } = await setup();
    const first = await createPrompt(
      env,
      workspaceId,
      'best monitoring tools?',
      ['Comparison'],
      25,
    );
    expect(first).toMatchObject({ ok: true, duplicated: false });
    const repeat = await createPrompt(
      env,
      workspaceId,
      'best monitoring tools?',
      [],
      25,
    );
    expect(repeat).toMatchObject({ ok: true, duplicated: true });
    if (repeat.ok) {
      expect(repeat.prompt.id).toBe(first.ok ? first.prompt.id : -1);
    }
  });

  test('refuses with the limit when the active-prompt ceiling is full', async () => {
    const { env, workspaceId, db } = await setup();
    await seedPrompt(db, workspaceId, 'occupied question?');
    const refused = await createPrompt(
      env,
      workspaceId,
      'one question too many?',
      [],
      1,
    );
    expect(refused).toEqual({ ok: false, reason: 'limit', limit: 1 });
  });

  test('an unlimited workspace inserts without a ceiling check', async () => {
    const { env, workspaceId } = await setup();
    const result = await createPrompt(
      env,
      workspaceId,
      'any question?',
      [],
      null,
    );
    expect(result).toMatchObject({ ok: true, duplicated: false });
  });
});

describe('updatePromptFields', () => {
  test('edits text and tags without touching active', async () => {
    const { env, workspaceId, db } = await setup();
    const id = await seedPrompt(db, workspaceId, 'old question?', [
      'Discovery',
    ]);
    const result = await updatePromptFields(env, id, workspaceId, {
      text: 'new question?',
      tags: ['Decision'],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.prompt).toMatchObject({
        text: 'new question?',
        tags: ['Decision'],
        active: true,
      });
    }
  });

  test('a text clash with another prompt refuses as duplicate', async () => {
    const { env, workspaceId, db } = await setup();
    await seedPrompt(db, workspaceId, 'taken question?');
    const id = await seedPrompt(db, workspaceId, 'free question?');
    const result = await updatePromptFields(env, id, workspaceId, {
      text: 'taken question?',
    });
    expect(result).toEqual({ ok: false, reason: 'duplicate' });
  });

  test('a same-text update of the prompt itself is not a clash', async () => {
    const { env, workspaceId, db } = await setup();
    const id = await seedPrompt(db, workspaceId, 'kept question?');
    const result = await updatePromptFields(env, id, workspaceId, {
      text: 'kept question?',
    });
    expect(result.ok).toBe(true);
  });

  test('an unknown or foreign id is not-found', async () => {
    const { env, workspaceId } = await setup();
    const result = await updatePromptFields(env, 424242, workspaceId, {
      text: 'ghost question?',
    });
    expect(result).toEqual({ ok: false, reason: 'not-found' });
  });
});

describe('setPromptActive', () => {
  test('deactivates and re-activates without limit friction', async () => {
    const { env, workspaceId, db } = await setup();
    const id = await seedPrompt(db, workspaceId, 'toggle question?');
    const off = await setPromptActive(env, id, workspaceId, false, 25);
    expect(off.ok && off.prompt.active).toBe(false);
    const on = await setPromptActive(env, id, workspaceId, true, 25);
    expect(on.ok && on.prompt.active).toBe(true);
  });

  test('activation is refused when the ceiling is already full', async () => {
    const { env, workspaceId, db } = await setup();
    await seedPrompt(db, workspaceId, 'active question?');
    const id = await seedPrompt(db, workspaceId, 'parked question?', [], false);
    const result = await setPromptActive(env, id, workspaceId, true, 1);
    expect(result).toEqual({ ok: false, reason: 'limit', limit: 1 });
  });

  test('activation with a text patch applies both atomically', async () => {
    const { env, workspaceId, db } = await setup();
    const id = await seedPrompt(db, workspaceId, 'parked question?', [], false);
    const result = await setPromptActive(env, id, workspaceId, true, 25, {
      text: 'awakened question?',
      tags: ['Authority'],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.prompt).toMatchObject({
        text: 'awakened question?',
        tags: ['Authority'],
        active: true,
      });
    }
  });

  test('retexting an active prompt stays within the ceiling', async () => {
    const { env, workspaceId, db } = await setup();
    const id = await seedPrompt(db, workspaceId, 'active question?');
    const result = await setPromptActive(env, id, workspaceId, true, 1, {
      text: 'renamed active question?',
    });
    expect(result.ok).toBe(true);
  });
});

describe('removePrompt', () => {
  test('a used prompt retires instead of deleting; unused deletes', async () => {
    const { env, workspaceId, db } = await setup();
    const usedId = await seedPrompt(db, workspaceId, 'history question?');
    await seedHistory(db, workspaceId, usedId);
    const used = await removePrompt(env, usedId, workspaceId, {
      retireWhenUsed: false,
    });
    expect(used).toEqual({ ok: false, reason: 'has-results' });
    const retired = await removePrompt(env, usedId, workspaceId, {
      retireWhenUsed: true,
    });
    expect(retired.ok && retired.action).toBe('retired');
    const stillThere = await db
      .select()
      .from(prompts)
      .where(eq(prompts.id, usedId));
    expect(stillThere[0]?.active).toBe(false);

    const unusedId = await seedPrompt(db, workspaceId, 'fresh question?');
    const deleted = await removePrompt(env, unusedId, workspaceId, {
      retireWhenUsed: true,
    });
    expect(deleted.ok && deleted.action).toBe('deleted');
    const gone = await db
      .select()
      .from(prompts)
      .where(eq(prompts.id, unusedId));
    expect(gone).toHaveLength(0);
  });

  test('an unknown id is not-found', async () => {
    const { env, workspaceId } = await setup();
    const result = await removePrompt(env, 424242, workspaceId, {
      retireWhenUsed: true,
    });
    expect(result).toEqual({ ok: false, reason: 'not-found' });
  });
});

describe('promptUsageCounts', () => {
  test('counts answers per prompt across the workspace runs only', async () => {
    const { env, workspaceId, db } = await setup();
    const counted = await seedPrompt(db, workspaceId, 'counted question?');
    await seedHistory(db, workspaceId, counted);
    await seedPrompt(db, workspaceId, 'silent question?');
    const usage = await promptUsageCounts(env, workspaceId);
    expect(usage.get(counted)).toBe(1);
    expect(usage.size).toBe(1);
  });
});
