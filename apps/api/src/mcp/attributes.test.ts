import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import type { Db } from '../db/client';
import * as schema from '../db/schema';
import {
  attributes,
  entities,
  entityScores,
  prompts,
  results,
  runs,
  users,
  workspaces,
} from '../db/schema';
import type { AppEnv } from '../env';
import {
  attributeLabel,
  countPromptsPerAttribute,
  findAttributeByLabel,
  resolveAttributeId,
  ungroupedPromptCount,
} from '../lib/attributes';
import { getAttributePerformance } from './data';

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
  '0021_brainy_blue_blade.sql',
];

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

const seedPrompt = async (
  db: Db,
  id: number,
  text: string,
  attributeId?: number,
) => {
  await db.insert(prompts).values({
    id,
    workspaceId: 9,
    text,
    tags: [],
    ...(attributeId === undefined ? {} : { attributeId }),
  });
};

const seedRun = async (db: Db, id: number, date: string) => {
  await db.insert(runs).values({
    id,
    workspaceId: 9,
    key: `cron:9:${date}`,
    date,
    trigger: 'cron',
    status: 'complete',
    entitySetHash: 'h1',
  } as typeof runs.$inferInsert);
};

const seedAnswer = async (
  db: Db,
  runId: number,
  promptId: number,
  options: { mentioned?: boolean; cited?: boolean; surface?: string } = {},
) => {
  const result = (
    await db
      .insert(results)
      .values({
        runId,
        promptId,
        surface: options.surface ?? 'chatgpt',
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
};

describe('attributeLabel', () => {
  test('folds whitespace and bounds the length', () => {
    expect(attributeLabel.parse('  File   management ')).toBe(
      'File management',
    );
    expect(attributeLabel.safeParse('x').success).toBe(false);
    expect(attributeLabel.safeParse('y'.repeat(81)).success).toBe(false);
    expect(attributeLabel.safeParse('ok label').success).toBe(true);
  });
});

describe('resolveAttributeId', () => {
  test('creates on first use and reuses after', async () => {
    const { db, workspaceId } = await setup();
    const first = await resolveAttributeId(db, workspaceId, 'File management');
    const second = await resolveAttributeId(db, workspaceId, 'File management');
    expect(first).not.toBeNull();
    expect(second).toBe(first);
  });

  // Labels are how a caller supplies one, so two spellings of the same label must
  // not create two attributes.
  test('matches an existing label case-insensitively', async () => {
    const { db, workspaceId } = await setup();
    const created = await resolveAttributeId(
      db,
      workspaceId,
      'File management',
    );
    const found = await findAttributeByLabel(
      db,
      workspaceId,
      'FILE MANAGEMENT',
    );
    expect(found?.id ?? null).toBe(created ?? null);
    const again = await resolveAttributeId(db, workspaceId, 'file management');
    expect(again).toBe(created ?? null);
  });

  // "Leave it alone" and "detach it" are different instructions.
  test('undefined means leave alone, null means detach', async () => {
    const { db, workspaceId } = await setup();
    expect(
      await resolveAttributeId(db, workspaceId, undefined),
    ).toBeUndefined();
    expect(await resolveAttributeId(db, workspaceId, null)).toBeNull();
    expect(await db.select().from(attributes)).toHaveLength(0);
  });

  test('rejects a label outside the bounds', async () => {
    const { db, workspaceId } = await setup();
    await expect(resolveAttributeId(db, workspaceId, 'x')).rejects.toThrow(
      /invalid attribute label/,
    );
  });

  test('attributes are scoped per workspace', async () => {
    const { db, workspaceId } = await setup();
    await db
      .insert(workspaces)
      .values({ id: 10, name: 'other', ownerUserId: 1 });
    const mine = await resolveAttributeId(db, workspaceId, 'File management');
    const theirs = await resolveAttributeId(db, 10, 'File management');
    expect(theirs).not.toBe(mine);
  });
});

describe('attribute counts', () => {
  test('count active grouped prompts and report the ungrouped remainder', async () => {
    const { db, workspaceId } = await setup();
    const files = await resolveAttributeId(db, workspaceId, 'File management');
    const scripting = await resolveAttributeId(db, workspaceId, 'Scripting');
    await seedPrompt(db, 1, 'manage files by voice?', files ?? undefined);
    await seedPrompt(db, 2, 'run a script by voice?', scripting ?? undefined);
    await seedPrompt(db, 3, 'no attribute at all?');
    // A retired prompt stops being counted: it is no longer part of the set being
    // measured, even though its history stays queryable.
    await db.update(prompts).set({ active: false }).where(eq(prompts.id, 3));

    const counts = await countPromptsPerAttribute(db, workspaceId);
    expect(counts.get(files ?? 0)).toBe(1);
    expect(counts.get(scripting ?? 0)).toBe(1);
    expect(await ungroupedPromptCount(db, workspaceId)).toBe(0);
  });

  test('ungrouped counts only active prompts with no attribute', async () => {
    const { db, workspaceId } = await setup();
    await seedPrompt(db, 1, 'loose one?');
    await seedPrompt(db, 2, 'loose two?');
    expect(await ungroupedPromptCount(db, workspaceId)).toBe(2);
  });
});

describe('getAttributePerformance', () => {
  test('rolls prompts up to the capability they test, worst first', async () => {
    const { db, env, workspaceId } = await setup();
    const scripting = await resolveAttributeId(db, workspaceId, 'Scripting');
    const files = await resolveAttributeId(db, workspaceId, 'File management');
    await seedPrompt(db, 1, 'run a script by voice?', scripting ?? undefined);
    await seedPrompt(db, 2, 'rename a file by voice?', files ?? undefined);
    await seedPrompt(db, 3, 'organize a folder by voice?', files ?? undefined);
    await seedRun(db, 1, '2026-09-25');
    await seedAnswer(db, 1, 1, { mentioned: true, cited: true });
    await seedAnswer(db, 1, 2, { mentioned: false, cited: false });
    await seedAnswer(db, 1, 3, { mentioned: false, cited: false });

    const result = await getAttributePerformance(env, workspaceId, '30d');
    if (result.needsSetup) {
      return;
    }
    // Worst first: File management scores zero and Scripting scores one.
    expect(result.attributes.map((a) => a.label)).toEqual([
      'File management',
      'Scripting',
    ]);
    const fileRow = result.attributes[0];
    expect(fileRow).toMatchObject({
      prompts: 2,
      measuredPrompts: 2,
      variants: 2,
      measured: true,
      variantWarning: null,
      answers: 2,
      mentionRate: 0,
      citationRate: 0,
    });
    expect(result.attributes[1]).toMatchObject({
      prompts: 1,
      mentionRate: 1,
      citationRate: 1,
    });
  });

  // The nudge is the whole point: one prompt measures wording, not capability.
  test('an attribute measured by one prompt is flagged unmeasured', async () => {
    const { db, env, workspaceId } = await setup();
    const scripting = await resolveAttributeId(db, workspaceId, 'Scripting');
    await seedPrompt(db, 1, 'run a script by voice?', scripting ?? undefined);
    await seedRun(db, 1, '2026-09-25');
    await seedAnswer(db, 1, 1, { mentioned: true, cited: true });

    const result = await getAttributePerformance(env, workspaceId, '30d');
    if (result.needsSetup) {
      return;
    }
    expect(result.attributes[0]).toMatchObject({
      label: 'Scripting',
      variants: 1,
      mentionRate: 1,
      variantWarning:
        'unmeasured: one prompt cannot separate this capability from its wording',
    });
  });

  test('an attribute with no answers is reported unmeasured rather than as a null finding', async () => {
    const { db, env, workspaceId } = await setup();
    const scripting = await resolveAttributeId(db, workspaceId, 'Scripting');
    await seedPrompt(db, 1, 'run a script by voice?', scripting ?? undefined);
    await seedRun(db, 1, '2026-09-25');
    await seedAnswer(db, 1, 1, { mentioned: false, cited: false });

    const result = await getAttributePerformance(env, workspaceId, '1d');
    if (result.needsSetup) {
      return;
    }
    // Tracked, but nothing collected in this window: measured is false and there
    // is no warning, because the issue is absence of data, not one prompt.
    expect(result.attributes[0]).toMatchObject({
      prompts: 1,
      variants: 1,
      measured: false,
      variantWarning: null,
      answers: 0,
      mentionRate: null,
    });
  });

  test('reports how many tracked prompts carry no attribute', async () => {
    const { db, env, workspaceId } = await setup();
    const files = await resolveAttributeId(db, workspaceId, 'File management');
    await seedPrompt(db, 1, 'rename a file by voice?', files ?? undefined);
    await seedPrompt(db, 2, 'loose prompt?');
    await seedRun(db, 1, '2026-09-25');
    await seedAnswer(db, 1, 1, { mentioned: true, cited: true });
    await seedAnswer(db, 1, 2, { mentioned: false, cited: false });

    const result = await getAttributePerformance(env, workspaceId, '30d');
    if (result.needsSetup) {
      return;
    }
    expect(result.ungrouped.prompts).toBe(1);
  });

  test('honors the cohort filter, defaulting to discovery', async () => {
    const { db, env, workspaceId } = await setup();
    const files = await resolveAttributeId(db, workspaceId, 'File management');
    await seedPrompt(db, 1, 'rename a file by voice?', files ?? undefined);
    await seedPrompt(db, 2, 'is mrmr any good for files?', files ?? undefined);
    await seedRun(db, 1, '2026-09-25');
    await seedAnswer(db, 1, 1, { mentioned: false, cited: false });
    await seedAnswer(db, 1, 2, { mentioned: true, cited: true });

    const byDefault = await getAttributePerformance(env, workspaceId, '30d');
    if (byDefault.needsSetup) {
      return;
    }
    // The brand-named prompt is brand_defining, so the default discovery
    // population excludes it and the attribute reads zero.
    expect(byDefault.population).toBe('discovery');
    // Both prompts carry the attribute, but the brand-named one is outside the
    // discovery population, and the two counts make that visible.
    expect(byDefault.attributes[0]).toMatchObject({
      prompts: 2,
      measuredPrompts: 1,
      mentionRate: 0,
    });

    const branded = await getAttributePerformance(env, workspaceId, '30d', [
      'brand_defining',
    ]);
    if (branded.needsSetup) {
      return;
    }
    expect(branded.population).toBe('brand_defining');
    expect(branded.attributes[0]).toMatchObject({
      prompts: 2,
      measuredPrompts: 1,
      mentionRate: 1,
    });
  });

  test('a workspace with no brand is the needs-setup response', async () => {
    const { db, env, workspaceId } = await setup();
    await db.delete(entities);
    const result = await getAttributePerformance(env, workspaceId, '30d');
    expect(result).toMatchObject({ needsSetup: true, range: '30d' });
  });
});
