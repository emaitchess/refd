import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import type { Db } from '../db/client';
import * as schema from '../db/schema';
import {
  entities,
  entityScores,
  prompts,
  results,
  runs,
  users,
  workspaces,
} from '../db/schema';
import type { AppEnv } from '../env';
import { MIGRATIONS as migrationFiles } from '../lib/test-migrations';
import { getPromptPerformance, getVisibilityOverview } from './data';

const MIGRATIONS = migrationFiles;

const makeD1 = (sqlite: Database) =>
  ({
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
          run: async () => {
            runStmt(...params);
            return { success: true, meta: {} };
          },
          raw: async () => all(...params).map((row) => Object.values(row)),
        }),
      };
    },
  }) as unknown as AppEnv['DB'];

const setup = async (surfaces: string[] | null = null) => {
  const sqlite = new Database(':memory:');
  for (const file of MIGRATIONS) {
    const sql = await Bun.file(
      new URL(`../../../../drizzle/${file}`, import.meta.url),
    ).text();
    for (const statement of sql.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed.length > 0) {
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
  await db.insert(workspaces).values({
    id: 9,
    name: 'ws',
    ownerUserId: 1,
    surfaces,
  });
  await db.insert(entities).values({
    id: 50,
    workspaceId: 9,
    name: 'mrmr',
    domains: ['getmrmr.com'],
    aliases: [],
    isBrand: true,
    sortOrder: 0,
  });
  return { db, env, workspaceId: 9, brandId: 50 };
};

const seed = async (
  db: Db,
  opts: {
    surface: string;
    date: string;
    promptIds: number[];
    mentioned?: number;
  },
) => {
  const runId = Math.abs(hash(opts.surface + opts.date)) % 100000;
  await db.insert(runs).values({
    id: runId,
    workspaceId: 9,
    key: `cron:9:${opts.date}:${opts.surface}`,
    date: opts.date,
    trigger: 'cron',
    status: 'complete',
    entitySetHash: 'h1',
  } as typeof runs.$inferInsert);
  let i = 0;
  for (const promptId of opts.promptIds) {
    const resultId = runId * 100 + i;
    await db.insert(results).values({
      id: resultId,
      runId,
      promptId,
      surface: opts.surface,
      sample: 1,
      provider: 'brightdata',
      ok: true,
      answerPresent: true,
    } as typeof results.$inferInsert);
    await db.insert(entityScores).values({
      runId,
      resultId,
      entityId: 50,
      mentioned: i < (opts.mentioned ?? 0),
      cited: false,
    } as unknown as typeof entityScores.$inferInsert);
    i += 1;
  }
};

const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return h;
};

const addPrompts = async (db: Db, count: number, kind?: string) => {
  const ids: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const id = 1000 + i;
    await db.insert(prompts).values({
      id,
      workspaceId: 9,
      text: `how do i manage local files variant ${i}`,
      category: 'Discovery',
      kind: kind ?? null,
    } as typeof prompts.$inferInsert);
    ids.push(id);
  }
  return ids;
};

describe('surface registry', () => {
  test('labels a surface that has data in the window but is not enabled as historical', async () => {
    // The disagreement this fixes: perplexity is switched off, but the 30-day
    // window still holds its results, so it used to appear in the analytics
    // unlabelled and a reader could not tell it was no longer running.
    const { db, env, workspaceId } = await setup(['chatgpt', 'gemini']);
    const ids = await addPrompts(db, 2);
    await seed(db, {
      surface: 'chatgpt',
      date: '2026-09-25',
      promptIds: ids,
      mentioned: 1,
    });
    await seed(db, {
      surface: 'perplexity',
      date: '2026-09-25',
      promptIds: ids,
      mentioned: 0,
    });

    const r = await getVisibilityOverview(env, workspaceId, '30d');
    if (r.needsSetup) throw new Error('expected data');

    const bySurface = new Map(
      r.surfaceRegistry.surfaces.map((s) => [s.surface, s.status]),
    );
    expect(bySurface.get('chatgpt')).toBe('enabled');
    expect(bySurface.get('gemini')).toBe('enabled');
    expect(bySurface.get('perplexity')).toBe('historical');
    expect(r.surfaceRegistry.historical).toEqual(['perplexity']);
    expect(r.surfaceRegistry.note).toContain('not currently enabled');

    // The status travels with the number, so the two cannot be read apart.
    const perplexity = r.surfaces.find((s) => s.surface === 'perplexity');
    expect(perplexity?.status).toBe('historical');
    const chatgpt = r.surfaces.find((s) => s.surface === 'chatgpt');
    expect(chatgpt?.status).toBe('enabled');
  });

  test('an enabled surface with no data yet is still present', async () => {
    // The other half: absence of data is not absence of a surface. A caller
    // must be able to ask "what are we tracking" and get the tracked set.
    const { db, env, workspaceId } = await setup(['chatgpt', 'gemini']);
    const ids = await addPrompts(db, 1);
    await seed(db, {
      surface: 'chatgpt',
      date: '2026-09-25',
      promptIds: ids,
      mentioned: 1,
    });
    const r = await getVisibilityOverview(env, workspaceId, '30d');
    if (r.needsSetup) throw new Error('expected data');
    expect(r.surfaceRegistry.enabled).toEqual(['chatgpt', 'gemini']);
    expect(r.surfaceRegistry.historical).toEqual([]);
    expect(r.surfaceRegistry.note).toContain('currently enabled');
  });

  test('surfaces are ordered canonically, not alphabetically', async () => {
    const { db, env, workspaceId } = await setup(['gemini', 'chatgpt']);
    const ids = await addPrompts(db, 1);
    await seed(db, {
      surface: 'perplexity',
      date: '2026-09-25',
      promptIds: ids,
      mentioned: 0,
    });
    const r = await getVisibilityOverview(env, workspaceId, '30d');
    if (r.needsSetup) throw new Error('expected data');
    // Canonical SURFACE_ORDER (chatgpt, perplexity, gemini), which is not the
    // alphabetical order a plain Set or sort would produce. Colour and chart
    // series both depend on this being stable.
    const order = r.surfaceRegistry.surfaces.map((s) => s.surface);
    expect(order).toEqual(['chatgpt', 'perplexity', 'gemini']);
  });
});

describe('getPromptPerformance summary bounding', () => {
  test('summary=true caps the zero-visibility list but reports the true count', async () => {
    // The bug: a 30-prompt workspace returned every zero-visibility prompt in
    // full from the one flag meant to keep the response small.
    const { db, env, workspaceId } = await setup(['chatgpt']);
    const ids = await addPrompts(db, 25);
    await seed(db, {
      surface: 'chatgpt',
      date: '2026-09-25',
      promptIds: ids,
      mentioned: 0,
    });

    const summary = await getPromptPerformance(env, workspaceId, '30d', true);
    if (summary.needsSetup) throw new Error('expected data');
    expect(summary.zeroVisibility.count).toBe(25);
    expect(summary.zeroVisibility.prompts.length).toBe(10);
    expect(summary.zeroVisibility.truncated).toBeTrue();

    // The full list stays reachable, and the count is never the capped one.
    const full = await getPromptPerformance(env, workspaceId, '30d', false);
    if (full.needsSetup) throw new Error('expected data');
    expect(full.zeroVisibility.count).toBe(25);
    expect(full.zeroVisibility.prompts.length).toBe(25);
    expect(full.zeroVisibility.truncated).toBeFalse();
  });

  test('a short zero-visibility list is not marked truncated', async () => {
    const { db, env, workspaceId } = await setup(['chatgpt']);
    const ids = await addPrompts(db, 3);
    await seed(db, {
      surface: 'chatgpt',
      date: '2026-09-25',
      promptIds: ids,
      mentioned: 0,
    });
    const r = await getPromptPerformance(env, workspaceId, '30d', true);
    if (r.needsSetup) throw new Error('expected data');
    expect(r.zeroVisibility.count).toBe(3);
    expect(r.zeroVisibility.truncated).toBeFalse();
  });
});
