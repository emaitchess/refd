import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
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
import {
  classifyWorkspacePrompts,
  promptKindOrDiscovery,
  workspaceCohorts,
} from '../lib/prompt-cohorts';
import { MIGRATIONS as migrationFiles } from '../lib/test-migrations';
import {
  getCitationSources,
  getPromptPerformance,
  getVisibilityOverview,
} from './data';

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
          // run must execute: without it, the backfill's updates through the D1
          // driver silently no-op and these tests would be asserting nothing.
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
  await db.insert(entities).values({
    id: 51,
    workspaceId: 9,
    name: 'Alter',
    domains: ['alterhq.com'],
    aliases: [{ value: 'alter' }],
    isBrand: false,
    sortOrder: 1,
  });
  return { db, env, workspaceId: 9, brandId: 50 };
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

const seedAnswer = async (
  db: Db,
  runId: number,
  promptId: number,
  entityId: number,
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
    entityId,
    mentioned: options.mentioned ?? false,
    cited: options.cited ?? false,
  });
};

const seedPrompt = async (db: Db, id: number, text: string) => {
  await db.insert(prompts).values({ id, workspaceId: 9, text, tags: [] });
  return id;
};

const kindsById = async (db: Db) => {
  const rows = await db.select().from(prompts).orderBy(prompts.id);
  return new Map(
    rows.map((row) => [row.id, promptKindOrDiscovery(row.kind)] as const),
  );
};

describe('classifyWorkspacePrompts', () => {
  test('classifies every unclassified prompt, brand-defining taking precedence', async () => {
    const { db, workspaceId } = await setup();
    await seedPrompt(db, 11, 'best alternative to Alter for dictation on Mac');
    await seedPrompt(db, 12, 'mrmr vs Alter: which is better on macOS?');
    await seedPrompt(db, 13, 'what are the best voice control apps for macOS?');

    expect(await classifyWorkspacePrompts(db, workspaceId)).toBe(3);
    expect(await kindsById(db)).toEqual(
      new Map([
        [11, 'alternative'],
        [12, 'brand_defining'],
        [13, 'discovery'],
      ]),
    );
  });

  // The backfill runs on the read that needs it, so it will be reached again
  // and again; a second pass must be a no-op rather than a rewrite.
  test('is idempotent and never overwrites an explicit kind', async () => {
    const { db, workspaceId } = await setup();
    await seedPrompt(db, 11, 'what are the best voice control apps?');
    await seedPrompt(db, 12, 'mrmr vs Alter: which is better?');
    await db
      .update(prompts)
      .set({ kind: 'brand_defining' })
      .where(eq(prompts.id, 11));

    expect(await classifyWorkspacePrompts(db, workspaceId)).toBe(1);
    expect(await classifyWorkspacePrompts(db, workspaceId)).toBe(0);
    // 11 stays branded even though its text names no brand: the operator said so.
    expect(await kindsById(db)).toEqual(
      new Map([
        [11, 'brand_defining'],
        [12, 'brand_defining'],
      ]),
    );
  });
});

describe('workspaceCohorts', () => {
  test('a null filter returns no cohorts (blended)', async () => {
    const { db, workspaceId } = await setup();
    await seedPrompt(db, 11, 'mrmr vs Alter?');
    expect(await workspaceCohorts(db, workspaceId, null)).toBeNull();
  });

  test('buckets prompt ids per cohort', async () => {
    const { db, workspaceId } = await setup();
    await seedPrompt(db, 11, 'mrmr vs Alter?');
    await seedPrompt(db, 12, 'best voice apps for macOS?');
    const cohorts = await workspaceCohorts(db, workspaceId, [
      'brand_defining',
      'discovery',
    ]);
    expect(cohorts).toEqual([
      { kind: 'brand_defining', promptIds: [11], prompts: 1 },
      { kind: 'discovery', promptIds: [12], prompts: 1 },
    ]);
  });
});

describe('getVisibilityOverview cohorts', () => {
  // The reported bug: a brand-defining prompt scores near 1.0 by construction, so
  // the blended headline overstates the unprompted-visibility number.
  test('a discovery filter drops the brand-defining prompt from the headline', async () => {
    const { db, env, workspaceId } = await setup();
    const branded = await seedPrompt(db, 11, 'mrmr vs Alter: which is better?');
    const discovery = await seedPrompt(
      db,
      12,
      'what are the best voice control apps for macOS?',
    );
    await seedRun(db, 1, '2026-09-25');
    // Branded prompt: mentioned and cited on both surfaces. Discovery: neither.
    for (const surface of ['chatgpt', 'perplexity']) {
      await seedAnswer(db, 1, branded, 50, {
        mentioned: true,
        cited: true,
        surface,
      });
      await seedAnswer(db, 1, discovery, 50, {
        mentioned: false,
        cited: false,
        surface,
      });
    }

    // Asking for nothing now yields the discovery cohort, not the blend.
    const unprompted = await getVisibilityOverview(env, workspaceId, '30d');
    expect(unprompted).toMatchObject({
      needsSetup: false,
      headline: {
        population: 'discovery',
        scope: 'prompts that name neither the brand nor a competitor',
        mentionRate: 0,
        citationRate: 0,
        n: 2,
      },
      blended: { deprecated: true, mentionRate: 0.5, citationRate: 0.5 },
    });

    // The blend is still available, still labelled, and never at the top level.
    const onlyBrandNamed = await getVisibilityOverview(
      env,
      workspaceId,
      '30d',
      ['brand_defining'],
    );
    expect(onlyBrandNamed).toMatchObject({
      headline: {
        population: 'brand_defining',
        mentionRate: 1,
        citationRate: 1,
      },
      blended: { mentionRate: 0.5, citationRate: 0.5 },
    });
  });

  test('a workspace with no discovery prompts falls back and says so', async () => {
    const { db, env, workspaceId } = await setup();
    const branded = await seedPrompt(db, 11, 'mrmr vs Alter: which is better?');
    // Classified up front: an unclassified prompt reads as discovery, which is
    // the point of the other test but not of this one.
    await db
      .update(prompts)
      .set({ kind: 'brand_defining' })
      .where(eq(prompts.id, branded));
    await seedRun(db, 1, '2026-09-25');
    await seedAnswer(db, 1, branded, 50, { mentioned: true, cited: true });
    // The fallback must be visible in the population name, not implicit.
    const result = await getVisibilityOverview(env, workspaceId, '30d');
    expect(result).toMatchObject({
      headline: { population: 'all', mentionRate: 1, citationRate: 1 },
    });
  });

  test('byCohort reports every cohort beside whichever one was asked for', async () => {
    const { db, env, workspaceId } = await setup();
    const branded = await seedPrompt(db, 11, 'mrmr vs Alter: which is better?');
    const competitor = await seedPrompt(db, 12, 'best alternative to Alter?');
    const discovery = await seedPrompt(
      db,
      13,
      'what are the best voice control apps for macOS?',
    );
    await seedRun(db, 1, '2026-09-25');
    await seedAnswer(db, 1, branded, 50, { mentioned: true, cited: true });
    await seedAnswer(db, 1, competitor, 50, { mentioned: true, cited: false });
    await seedAnswer(db, 1, discovery, 50, { mentioned: false, cited: false });

    const result = await getVisibilityOverview(env, workspaceId, '30d', [
      'discovery',
    ]);
    expect(result).toMatchObject({
      byCohort: {
        brand_defining: {
          prompts: 1,
          answers: 1,
          mentionRate: 1,
          citationRate: 1,
        },
        alternative: {
          prompts: 1,
          answers: 1,
          mentionRate: 1,
          citationRate: 0,
        },
        discovery: { prompts: 1, answers: 1, mentionRate: 0, citationRate: 0 },
        // The declared cohorts are always present and empty when unused, so a
        // reader sees the whole taxonomy rather than a key that came and went.
        market_perception: {
          prompts: 0,
          answers: 0,
          mentionRate: null,
          citationRate: null,
        },
        problem: {
          prompts: 0,
          answers: 0,
          mentionRate: null,
          citationRate: null,
        },
      },
    });
  });

  test('a cohort filter matching no prompt yields null rates, not the blended ones', async () => {
    const { db, env, workspaceId } = await setup();
    const discovery = await seedPrompt(
      db,
      11,
      'what are the best voice control apps for macOS?',
    );
    await seedRun(db, 1, '2026-09-25');
    await seedAnswer(db, 1, discovery, 50, { mentioned: true, cited: true });

    const result = await getVisibilityOverview(env, workspaceId, '30d', [
      'brand_defining',
    ]);
    // The headline is the requested cohort, so an empty cohort is null rather
    // than a fallback to something else. The blend beside it is unaffected: a
    // filter that matches nothing must not blank the deprecated block either.
    expect(result).toMatchObject({
      headline: {
        population: 'brand_defining',
        n: 0,
        mentionRate: null,
        citationRate: null,
      },
      blended: { deprecated: true, n: 1, mentionRate: 1, citationRate: 1 },
    });
  });
});

describe('getPromptPerformance cohorts', () => {
  test('the filter applies to the prompt list and to zeroVisibility', async () => {
    const { db, env, workspaceId } = await setup();
    const branded = await seedPrompt(db, 11, 'mrmr vs Alter: which is better?');
    const discoveryA = await seedPrompt(
      db,
      12,
      'what are the best voice control apps for macOS?',
    );
    const discoveryB = await seedPrompt(
      db,
      13,
      'how do voice apps handle files on a Mac?',
    );
    await seedRun(db, 1, '2026-09-25');
    await seedAnswer(db, 1, branded, 50, { mentioned: true, cited: true });
    await seedAnswer(db, 1, discoveryA, 50, { mentioned: false, cited: false });
    await seedAnswer(db, 1, discoveryB, 50, { mentioned: false, cited: false });

    const result = await getPromptPerformance(env, workspaceId, '30d', true, [
      'discovery',
    ]);
    expect(result).toMatchObject({ kind: ['discovery'] });
    if (result.needsSetup) {
      return;
    }
    expect(result.prompts.map((p) => p.id)).toEqual([discoveryA, discoveryB]);
    // Both discovery prompts have answers and a zero mention rate, so both
    // belong in zeroVisibility; the brand-defining prompt must not appear.
    expect(result.zeroVisibility.count).toBe(2);
    expect(result.zeroVisibility.truncated).toBeFalse();
    expect(result.zeroVisibility.prompts.map((p) => p.id)).toEqual([
      discoveryA,
      discoveryB,
    ]);
    expect(result.prompts.every((p) => p.kind === 'discovery')).toBe(true);
  });

  test('an unfiltered call reports each prompt cohort', async () => {
    const { db, env, workspaceId } = await setup();
    await seedPrompt(db, 11, 'mrmr vs Alter: which is better?');
    await seedPrompt(db, 12, 'what are the best voice control apps for macOS?');
    await seedRun(db, 1, '2026-09-25');

    const result = await getPromptPerformance(env, workspaceId, '30d', true);
    if (result.needsSetup) {
      return;
    }
    expect(result.prompts.map((p) => [p.id, p.kind])).toEqual([
      [11, 'brand_defining'],
      [12, 'discovery'],
    ]);
  });
});

describe('getCitationSources cohorts', () => {
  const seedCitation = async (
    db: Db,
    resultId: number,
    domain: string,
    entityId: number | null,
  ) => {
    await db.insert(citations).values({
      resultId,
      url: `https://${domain}/page`,
      host: domain,
      registrableDomain: domain,
      entityId,
    });
  };

  const resultIdFor = async (
    db: Db,
    runId: number,
    promptId: number,
  ): Promise<number> => {
    const row = (
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
    if (!row) {
      throw new Error('result seed failed');
    }
    return row.id;
  };

  test('the filter narrows the cited domains to that cohort', async () => {
    const { db, env, workspaceId } = await setup();
    const branded = await seedPrompt(db, 11, 'mrmr vs Alter: which is better?');
    const discovery = await seedPrompt(
      db,
      12,
      'what are the best voice control apps for macOS?',
    );
    await seedRun(db, 1, '2026-09-25');
    await seedCitation(
      db,
      await resultIdFor(db, 1, branded),
      'alterhq.com',
      51,
    );
    await seedCitation(
      db,
      await resultIdFor(db, 1, discovery),
      'example.com',
      null,
    );

    const blended = await getCitationSources(env, workspaceId, '30d');
    expect(blended).toMatchObject({
      headlineScope: 'blended across all prompt cohorts',
    });
    if (blended.needsSetup) {
      return;
    }
    expect(blended.domains.map((d) => d.domain).sort()).toEqual([
      'alterhq.com',
      'example.com',
    ]);

    const unprompted = await getCitationSources(env, workspaceId, '30d', [
      'discovery',
    ]);
    expect(unprompted).toMatchObject({
      headlineScope: 'prompts that name neither the brand nor a competitor',
    });
    if (unprompted.needsSetup) {
      return;
    }
    expect(unprompted.domains.map((d) => d.domain)).toEqual(['example.com']);
  });

  // An empty IN () list is not portable across the D1 driver, so the empty
  // cohort is answered before any query runs. A filter that matches nothing
  // must read as nothing, never as the unfiltered set.
  test('a cohort filter matching no prompt returns empty, not the blended set', async () => {
    const { db, env, workspaceId } = await setup();
    const discovery = await seedPrompt(
      db,
      12,
      'what are the best voice control apps for macOS?',
    );
    await seedRun(db, 1, '2026-09-25');
    await seedCitation(
      db,
      await resultIdFor(db, 1, discovery),
      'example.com',
      null,
    );

    const result = await getCitationSources(env, workspaceId, '30d', [
      'brand_defining',
    ]);
    expect(result).toMatchObject({
      needsSetup: false,
      headlineScope: 'prompts that name your brand',
      domains: [],
      unattributableCitations: 0,
      brandUrls: [],
      sourceGap: [],
    });
  });
});
