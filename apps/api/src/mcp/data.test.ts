import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import type { Db } from '../db/client';
import * as schema from '../db/schema';
import {
  citations,
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
import { getPromptCitations, getPromptRunDiff, getRunHistory } from './data';

// Migrations applied to an in-memory SQLite so the run-history, run-diff, and
// citation reads run as real queries over seeded run pairs, not mocks.
const MIGRATIONS = migrationFiles;

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
  brandId: number;
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
  await db.insert(workspaces).values({ id: 9, name: 'ws', ownerUserId: 1 });
  await db.insert(entities).values({
    id: 50,
    workspaceId: 9,
    name: 'Brand',
    domains: ['brand.example'],
    aliases: [],
    isBrand: true,
    sortOrder: 0,
  });
  return { db, env, workspaceId: 9, brandId: 50 };
};

const seedRun = async (
  db: Db,
  workspaceId: number,
  id: number,
  key: string,
  date: string,
  options: { dispatchPlan?: Record<string, unknown>; status?: string } = {},
) => {
  const values = {
    id,
    workspaceId,
    key,
    date,
    trigger: 'cron',
    status: options.status ?? 'complete',
    entitySetHash: 'h1',
    ...(options.dispatchPlan !== undefined
      ? { dispatchPlan: options.dispatchPlan }
      : {}),
  } as typeof runs.$inferInsert;
  await db.insert(runs).values(values);
};

const seedAnswer = async (
  db: Db,
  runId: number,
  promptId: number,
  options: {
    mentioned?: boolean;
    cited?: boolean;
    citations?: {
      url: string;
      registrableDomain: string;
      entityId: number | null;
    }[];
  } = {},
) => {
  const result = (
    await db
      .insert(results)
      .values({
        runId,
        promptId,
        surface: 'chatgpt',
        sample: 1,
        provider: 'brightdata',
        ok: true,
        answerPresent: true,
      })
      .returning({ id: results.id })
  )[0];
  if (!result) {
    throw new Error('result seed failed');
  }
  await db.insert(entityScores).values({
    resultId: result.id,
    entityId: 50,
    mentioned: options.mentioned ?? false,
    cited: options.cited ?? false,
  });
  for (const citation of options.citations ?? []) {
    await db.insert(citations).values({
      resultId: result.id,
      url: citation.url,
      registrableDomain: citation.registrableDomain,
      entityId: citation.entityId,
    });
  }
};

const seedPrompt = async (db: Db, text: string, id?: number) => {
  const row = await db
    .insert(prompts)
    .values({ ...(id ? { id } : {}), workspaceId: 9, text, tags: [] })
    .returning({ id: prompts.id });
  return row[0]?.id as number;
};

describe('getRunHistory', () => {
  test('returns runs newest first with the frozen prompt count', async () => {
    const { env, db, workspaceId } = await setup();
    await seedRun(db, workspaceId, 3, 'cron:9:2026-09-25', '2026-09-25', {
      dispatchPlan: { prompts: [{ id: 1 }, { id: 2 }, { id: 3 }] },
    });
    await seedRun(db, workspaceId, 2, 'manual:x', '2026-09-24', {
      status: 'running',
    });
    await seedRun(db, workspaceId, 1, 'cron:9:2026-09-23', '2026-09-23');
    const history = await getRunHistory(env, workspaceId, 2);
    expect(history.runs.map((run) => run.id)).toEqual([3, 2]);
    expect(history.runs[0]).toMatchObject({
      promptCount: 3,
      status: 'complete',
      entitySetHash: 'h1',
    });
    // A legacy run without a persisted plan reports a null prompt count.
    expect(history.runs[1]?.promptCount).toBeNull();
  });
});

describe('getPromptRunDiff', () => {
  test('diffs shared prompts and lists set entries and exits', async () => {
    const { env, db, workspaceId } = await setup();
    const improving = await seedPrompt(db, 'improving question?');
    const enteredZero = await seedPrompt(db, 'zeroed question?');
    const exitedOnly = await seedPrompt(db, 'exited question?', 990);
    const enteredOnly = await seedPrompt(db, 'entered question?', 991);
    await seedRun(db, workspaceId, 1, 'cron:9:2026-09-24', '2026-09-24');
    await seedRun(db, workspaceId, 2, 'cron:9:2026-09-25', '2026-09-25');

    // improving: not mentioned before, mentioned now.
    await seedAnswer(db, 1, improving, { mentioned: false });
    await seedAnswer(db, 2, improving, { mentioned: true, cited: true });
    // enteredZero: mentioned before, silent now.
    await seedAnswer(db, 1, enteredZero, { mentioned: true });
    await seedAnswer(db, 2, enteredZero, { mentioned: false });
    // exited: answered in the previous run only.
    await seedAnswer(db, 1, exitedOnly, { mentioned: true });
    // entered: answered in the latest run only.
    await seedAnswer(db, 2, enteredOnly, { mentioned: true });

    const diff = await getPromptRunDiff(env, workspaceId);
    expect(diff.status).toBe('ok');
    if (diff.status !== 'ok') {
      return;
    }
    expect(diff.latestRun.id).toBe(2);
    expect(diff.previousRun.id).toBe(1);
    expect(diff.entitySetChanged).toBe(false);

    const byPrompt = new Map(diff.prompts.map((row) => [row.promptId, row]));
    const improvingRow = byPrompt.get(improving);
    expect(improvingRow).toMatchObject({
      mentionDelta: 1,
      citationDelta: 1,
      // One answer before with no mention IS zero visibility, so the
      // improvement is also an exit from that state.
      transition: 'exited-zero',
    });
    expect(improvingRow?.previous).toMatchObject({ mentionRate: 0 });
    expect(improvingRow?.current).toMatchObject({ mentionRate: 1 });

    const zeroRow = byPrompt.get(enteredZero);
    expect(zeroRow).toMatchObject({
      transition: 'entered-zero',
      mentionDelta: -1,
    });
    expect(zeroRow?.current).toMatchObject({ zeroVisibility: true });

    expect(diff.exited).toEqual([{ promptId: 990, text: 'exited question?' }]);
    expect(diff.entered).toEqual([
      { promptId: 991, text: 'entered question?' },
    ]);
  });

  test('a workspace with fewer than two completed runs needs runs', async () => {
    const { env, db, workspaceId } = await setup();
    await seedRun(db, workspaceId, 1, 'cron:9:2026-09-24', '2026-09-24');
    const diff = await getPromptRunDiff(env, workspaceId);
    expect(diff.status).toBe('needs-runs');
  });
});

describe('getPromptCitations', () => {
  test('groups cited URLs for one prompt with an isOurs flag', async () => {
    const { env, db, workspaceId } = await setup();
    const promptId = await seedPrompt(db, 'cited question?');
    const otherId = await seedPrompt(db, 'other question?');
    await seedRun(db, workspaceId, 1, 'cron:9:2026-09-25', '2026-09-25');
    await seedAnswer(db, 1, promptId, {
      citations: [
        {
          url: 'https://brand.example/guide',
          registrableDomain: 'brand.example',
          entityId: 50,
        },
        {
          url: 'https://brand.example/guide',
          registrableDomain: 'brand.example',
          entityId: 50,
        },
        {
          url: 'https://press.example/story',
          registrableDomain: 'press.example',
          entityId: null,
        },
      ],
    });
    await seedAnswer(db, 1, otherId, {
      citations: [
        {
          url: 'https://elsewhere.example/x',
          registrableDomain: 'elsewhere.example',
          entityId: null,
        },
      ],
    });

    const detail = await getPromptCitations(env, workspaceId, promptId, '30d');
    expect(detail).toMatchObject({ found: true, citationCount: 3 });
    if (!detail.found) {
      return;
    }
    expect(detail.urls).toEqual([
      {
        url: 'https://brand.example/guide',
        domain: 'brand.example',
        isOurs: true,
        citations: 2,
        answers: 1,
      },
      {
        url: 'https://press.example/story',
        domain: 'press.example',
        isOurs: false,
        citations: 1,
        answers: 1,
      },
    ]);
  });

  test('an unknown prompt is reported as not found', async () => {
    const { env, workspaceId } = await setup();
    const detail = await getPromptCitations(env, workspaceId, 424242, '30d');
    expect(detail).toMatchObject({ found: false, promptId: 424242 });
  });
});
