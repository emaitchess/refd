import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
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
import { getIntentPerformance } from './data';
import { addPromptBodySchema, updatePromptBodySchema } from './ops-tools';

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
          // run must execute, or the updates under test silently no-op.
          run: async () => {
            runStmt(...params);
            return { success: true, meta: {} };
          },
          raw: async () => all(...params).map((row) => Object.values(row)),
        }),
      };
    },
  }) as unknown as AppEnv['DB'];

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
    name: 'mrmr',
    domains: ['getmrmr.com'],
    aliases: [],
    isBrand: true,
    sortOrder: 0,
  });
  return { db, env, workspaceId: 9, brandId: 50 };
};

type Axes = {
  funnelStage?: 'awareness' | 'consideration' | 'decision' | null;
  questionType?:
    | 'informational'
    | 'navigational'
    | 'commercial'
    | 'transactional'
    | null;
};

const seedPrompt = async (
  db: Db,
  id: number,
  text: string,
  axes: Axes = {},
) => {
  await db.insert(prompts).values({
    id,
    workspaceId: 9,
    text,
    tags: [],
    kind: 'discovery',
    ...(axes.funnelStage !== undefined
      ? { funnelStage: axes.funnelStage }
      : {}),
    ...(axes.questionType !== undefined
      ? { questionType: axes.questionType }
      : {}),
  } as typeof prompts.$inferInsert);
};

const seedAnswer = async (
  db: Db,
  runId: number,
  promptId: number,
  mentioned = false,
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
    mentioned,
    cited: false,
  });
};

const seedRun = async (db: Db, runId: number, date: string) => {
  await db.insert(runs).values({
    id: runId,
    workspaceId: 9,
    key: `cron:9:${date}`,
    date,
    trigger: 'cron',
    status: 'complete',
    entitySetHash: 'h1',
  } as typeof runs.$inferInsert);
};

describe('getIntentPerformance', () => {
  test('rolls up by declared funnel stage, worst first', async () => {
    const { db, env, workspaceId } = await setup();
    await seedRun(db, 1, '2026-09-25');
    for (let i = 1; i <= 6; i += 1) {
      await seedPrompt(db, i, `awareness question ${i}`, {
        funnelStage: 'awareness',
        questionType: 'informational',
      });
      await seedAnswer(db, 1, i, i <= 1);
    }
    for (let i = 10; i <= 15; i += 1) {
      await seedPrompt(db, i, `decision question ${i}`, {
        funnelStage: 'decision',
        questionType: 'transactional',
      });
      await seedAnswer(db, 1, i, true);
    }

    const r = await getIntentPerformance(env, workspaceId, '30d');
    if (r.needsSetup) throw new Error('expected data');
    // Measured buckets lead worst-first; a stage nobody declared has no rate and
    // sorts after them rather than pretending to be the worst.
    expect(r.stages.map((s) => s.value)).toEqual([
      'awareness',
      'decision',
      'consideration',
    ]);
    const awareness = r.stages.find((s) => s.value === 'awareness');
    expect(awareness?.prompts).toBe(6);
    expect(awareness?.measuredPrompts).toBe(6);
    expect(awareness?.mentionRate).toBeCloseTo(1 / 6, 3);
    const decision = r.stages.find((s) => s.value === 'decision');
    expect(decision?.mentionRate).toBe(1);
    // A stage nobody declared is present with nothing in it, not omitted: its
    // absence is a fact about the prompt set.
    const consideration = r.stages.find((s) => s.value === 'consideration');
    expect(consideration?.prompts).toBe(0);
    expect(consideration?.answers).toBe(0);
  });

  test('an undeclared prompt is counted, not folded into a default stage', async () => {
    const { db, env, workspaceId } = await setup();
    await seedRun(db, 1, '2026-09-25');
    await seedPrompt(db, 1, 'declared', { funnelStage: 'awareness' });
    await seedPrompt(db, 2, 'never declared');
    await seedAnswer(db, 1, 1, true);
    await seedAnswer(db, 1, 2, false);

    const r = await getIntentPerformance(env, workspaceId, '30d');
    if (r.needsSetup) throw new Error('expected data');
    // The undeclared prompt is not silently an awareness prompt.
    const awareness = r.stages.find((s) => s.value === 'awareness');
    expect(awareness?.prompts).toBe(1);
    expect(r.undeclared.funnelStage).toBe(1);
    expect(r.undeclared.note).toContain('excluded from every bucket');
  });

  test('the two axes are independent', async () => {
    const { db, env, workspaceId } = await setup();
    await seedRun(db, 1, '2026-09-25');
    // Awareness + commercial is a real combination, and must be readable on
    // both axes rather than one shadowing the other.
    await seedPrompt(db, 1, 'what are the best options', {
      funnelStage: 'awareness',
      questionType: 'commercial',
    });
    await seedAnswer(db, 1, 1, true);

    const r = await getIntentPerformance(env, workspaceId, '30d');
    if (r.needsSetup) throw new Error('expected data');
    expect(r.stages.find((s) => s.value === 'awareness')?.prompts).toBe(1);
    expect(r.types.find((t) => t.value === 'commercial')?.prompts).toBe(1);
    expect(r.funnelStageScope).toBe('every declared stage');
    expect(r.questionTypeScope).toBe('every declared type');
  });

  test('a stage filter narrows the pool on both axes', async () => {
    const { db, env, workspaceId } = await setup();
    await seedRun(db, 1, '2026-09-25');
    await seedPrompt(db, 1, 'a', { funnelStage: 'awareness' });
    await seedPrompt(db, 2, 'b', { funnelStage: 'decision' });
    await seedAnswer(db, 1, 1, true);
    await seedAnswer(db, 1, 2, false);

    const r = await getIntentPerformance(env, workspaceId, '30d', null, {
      funnelStage: ['awareness'],
    });
    if (r.needsSetup) throw new Error('expected data');
    expect(r.funnelStageScope).toBe('awareness');
    // The decision prompt is out of the pool entirely, so its answer cannot
    // reach any bucket on either axis.
    expect(r.stages.find((s) => s.value === 'awareness')?.prompts).toBe(1);
    expect(r.stages.find((s) => s.value === 'decision')?.answers).toBe(0);
    expect(r.stages.find((s) => s.value === 'decision')?.prompts).toBe(1);
  });

  test('a filter matching nothing yields no rows rather than every row', async () => {
    const { db, env, workspaceId } = await setup();
    await seedRun(db, 1, '2026-09-25');
    await seedPrompt(db, 1, 'a', { funnelStage: 'awareness' });
    await seedAnswer(db, 1, 1, true);

    const r = await getIntentPerformance(env, workspaceId, '30d', null, {
      funnelStage: ['transactional-unknown' as never],
    });
    if (r.needsSetup) throw new Error('expected data');
    // Nothing matches, so nothing is measured. Reporting the awareness prompt
    // here would be the blend leaking through a filter that matched nothing.
    expect(r.stages.every((s) => s.answers === 0)).toBeTrue();
  });

  test('the cohort filter and the axis filter compose', async () => {
    const { db, env, workspaceId } = await setup();
    await seedRun(db, 1, '2026-09-25');
    await seedPrompt(db, 1, 'unnamed and undeclared');
    await seedAnswer(db, 1, 1, true);
    await db.insert(prompts).values({
      id: 2,
      workspaceId: 9,
      text: 'names the brand',
      tags: [],
      kind: 'brand_defining',
      funnelStage: 'consideration',
    } as typeof prompts.$inferInsert);
    await seedAnswer(db, 1, 2, true);

    // Defaulting to the discovery cohort excludes the brand-named prompt, and
    // the declared stage on it cannot pull it back in.
    const r = await getIntentPerformance(env, workspaceId, '30d');
    if (r.needsSetup) throw new Error('expected data');
    expect(r.population).toContain('discovery');
    expect(r.stages.find((s) => s.value === 'consideration')?.answers).toBe(0);
  });

  test('a workspace with no brand is the needs-setup response', async () => {
    const { db, env, workspaceId } = await setup();
    // Retire the brand so the read has no entity to measure against.
    await db.delete(entities);
    const r = await getIntentPerformance(env, workspaceId, '30d');
    expect(r.needsSetup).toBeTrue();
  });
});

describe('declared axes on the prompt write path', () => {
  test('add_prompt accepts a declared stage and type, and refuses an unknown one', () => {
    const good = addPromptBodySchema.safeParse({
      text: 'how do I manage local files on macOS',
      funnelStage: 'awareness',
      questionType: 'informational',
    });
    expect(good.success).toBeTrue();
    expect(
      addPromptBodySchema.safeParse({
        text: 'how do I manage local files on macOS',
        funnelStage: 'awareness',
        questionType: 'nonsense',
      }).success,
    ).toBeFalse();
  });

  test('omitting an axis leaves the prompt undeclared rather than defaulting it', () => {
    const parsed = addPromptBodySchema.parse({
      text: 'how do I manage local files on macOS',
    });
    expect(parsed.funnelStage).toBeUndefined();
    expect(parsed.questionType).toBeUndefined();
  });

  test('update_prompt separates clearing a declaration from leaving it alone', () => {
    const clear = updatePromptBodySchema.safeParse({
      promptId: 1,
      funnelStage: null,
    });
    expect(clear.success).toBeTrue();
    expect(clear.success && clear.data.funnelStage).toBeNull();
    // A promptId on its own changes nothing, and the schema refuses it rather
    // than reporting a successful no-op: a caller who meant to clear a stage
    // would otherwise believe it worked.
    const noop = updatePromptBodySchema.safeParse({ promptId: 1 });
    expect(noop.success).toBeFalse();
    // Naming one axis is enough to make the patch meaningful.
    const clearType = updatePromptBodySchema.safeParse({
      promptId: 1,
      questionType: null,
    });
    expect(clearType.success).toBeTrue();
    expect(clearType.success && clearType.data.questionType).toBeNull();
    expect(clearType.success && clearType.data.funnelStage).toBeUndefined();
  });

  test('the stored column is exactly what was declared', async () => {
    const { db, workspaceId } = await setup();
    await seedPrompt(db, 1, 'a', { funnelStage: 'consideration' });
    const row = (await db.select().from(prompts).where(eq(prompts.id, 1)))[0];
    expect(row?.funnelStage).toBe('consideration');
    expect(row?.questionType).toBeNull();
    // Workspace scoping is unaffected by the new columns.
    expect(row?.workspaceId).toBe(workspaceId);
  });
});
