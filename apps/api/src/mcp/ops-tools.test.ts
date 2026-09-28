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
import type { IngestMessage } from '../ingest/messages';
import { MIGRATIONS as migrationFiles } from '../lib/test-migrations';
import type { McpPrincipal, McpWorkspace } from './context';
import {
  addCompetitor,
  addPrompt,
  addPromptBodySchema,
  ensureOperationalWorkspace,
  listCompetitors,
  listPrompts,
  removeCompetitor,
  removePromptBodySchema,
  removePromptTool,
  runNow,
  runNowBodySchema,
  setSurfaceEnabled,
  togglePrompt,
  togglePromptBodySchema,
  unwrapPrompt,
  updatePrompt,
  updatePromptBodySchema,
} from './ops-tools';

// Migrations applied to an in-memory SQLite so the gates, limits, and
// run-creation execute against real rows, not mocks.
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
  workspace: McpWorkspace;
  principal: McpPrincipal;
  sent: IngestMessage[];
}

const standardPrincipal = (email = 'owner@example.com'): McpPrincipal =>
  ({
    userEmail: email,
    userId: 1,
    scopes: ['data:write'],
  }) as unknown as McpPrincipal;

const setup = async (
  options: {
    adminEmails?: string;
    onboarded?: boolean;
    committed?: boolean;
  } = {},
): Promise<Fixture> => {
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
  const sent: IngestMessage[] = [];
  const queue = async (messages: { body: IngestMessage }[]) => {
    sent.push(...messages.map((message) => message.body));
  };
  const env = {
    DB: makeD1(sqlite),
    ADMIN_EMAILS: options.adminEmails ?? '',
    SAMPLES: '1',
    PROMPT_BATCH_SIZE: '5',
    INGEST: { send: queue, sendBatch: queue },
  } as unknown as AppEnv;
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
    onboardingCompleted: options.onboarded ?? false,
    profile: options.committed ? { committed: true } : null,
  });
  return {
    db,
    env,
    workspace: { id: 9, name: 'ws' },
    principal: standardPrincipal(),
    sent,
  };
};

const db_history = async (db: Db, entityId: number) => {
  const prompt = (
    await db
      .insert(prompts)
      .values({ workspaceId: 9, text: 'history question?', tags: [] })
      .returning({ id: prompts.id })
  )[0];
  if (!prompt) {
    throw new Error('history prompt seed failed');
  }
  await db.insert(runs).values({
    id: 70,
    workspaceId: 9,
    key: 'cron:9:2026-01-01',
    date: '2026-01-01',
    trigger: 'cron',
    status: 'complete',
  });
  const result = (
    await db
      .insert(results)
      .values({
        runId: 70,
        promptId: prompt.id,
        surface: 'chatgpt',
        sample: 1,
        provider: 'brightdata',
        ok: true,
      })
      .returning({ id: results.id })
  )[0];
  if (!result) {
    throw new Error('history seed failed');
  }
  await db.insert(entityScores).values({ resultId: result.id, entityId });
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

describe('prompt tool schemas', () => {
  test('add folds category case onto the canonical set and bounds text', () => {
    expect(
      addPromptBodySchema.safeParse({
        text: 'which tools track AI visibility?',
        category: 'comparison',
      }).data,
    ).toMatchObject({ category: 'Comparison' });
    expect(
      addPromptBodySchema.safeParse({
        text: 'too short',
        category: 'Awareness',
      }).success,
    ).toBeFalse();
    expect(
      addPromptBodySchema.safeParse({ text: 'x'.repeat(501) }).success,
    ).toBeFalse();
  });

  test('update demands a text, category, or kind change and a positive id', () => {
    expect(
      updatePromptBodySchema.safeParse({ promptId: 1 }).success,
    ).toBeFalse();
    expect(
      updatePromptBodySchema.safeParse({
        promptId: 1,
        category: 'Authority',
      }).success,
    ).toBeTrue();
    expect(
      updatePromptBodySchema.safeParse({
        promptId: 0,
        text: 'reworded question?',
      }).success,
    ).toBeFalse();
  });

  test('kind is optional on add, bounded on both, and a kind-only update is legal', () => {
    // An omitted kind must be absent from the parsed body, not present-and-
    // undefined, so the handler can tell "classify it" from "set it".
    const omitted = addPromptBodySchema.safeParse({
      text: 'which tools track AI visibility?',
    });
    expect(omitted.success).toBeTrue();
    expect(omitted.success && 'kind' in omitted.data).toBeFalse();
    expect(
      addPromptBodySchema.safeParse({
        text: 'which tools track AI visibility?',
        kind: 'brand_defining',
      }).data,
    ).toMatchObject({ kind: 'brand_defining' });
    for (const kind of ['named', '', 'DISCOVERY', 1, null]) {
      expect(
        addPromptBodySchema.safeParse({
          text: 'which tools track AI visibility?',
          kind,
        }).success,
      ).toBeFalse();
    }
    expect(
      updatePromptBodySchema.safeParse({ promptId: 1, kind: 'alternative' })
        .success,
    ).toBeTrue();
    expect(
      updatePromptBodySchema.safeParse({ promptId: 1, kind: 'nope' }).success,
    ).toBeFalse();
  });

  test('toggle requires an explicit boolean; remove and run_now bound ids', () => {
    expect(
      togglePromptBodySchema.safeParse({ promptId: 1, active: true }).success,
    ).toBeTrue();
    expect(
      togglePromptBodySchema.safeParse({ promptId: 1, active: 'yes' }).success,
    ).toBeFalse();
    expect(
      removePromptBodySchema.safeParse({ promptId: -3 }).success,
    ).toBeFalse();
    expect(runNowBodySchema.safeParse({ samples: 11 }).success).toBeFalse();
    expect(runNowBodySchema.safeParse({ samples: 2 }).success).toBeTrue();
  });

  test('a failure object becomes an isError result; a success stays content', () => {
    const failure = unwrapPrompt({
      ok: false,
      error: { code: 'not_found', message: 'nope' },
      status: 404,
    }) as { isError?: boolean };
    expect(failure.isError).toBe(true);
    const ok = unwrapPrompt({ ok: true, prompt: { id: 1 } }) as {
      isError?: boolean;
    };
    expect(ok.isError).toBeUndefined();
  });
});

describe('operational workspace gate', () => {
  test('refuses a workspace whose setup has neither committed nor completed', async () => {
    const { env, workspace } = await setup();
    await expect(ensureOperationalWorkspace(env, workspace)).rejects.toThrow(
      'has not finished onboarding',
    );
  });

  test('allows a committed (mid-report) or fully onboarded workspace', async () => {
    const committed = await setup({ committed: true });
    await expect(
      ensureOperationalWorkspace(committed.env, committed.workspace),
    ).resolves.toBeUndefined();
    const onboarded = await setup({ onboarded: true });
    await expect(
      ensureOperationalWorkspace(onboarded.env, onboarded.workspace),
    ).resolves.toBeUndefined();
  });
});

describe('prompt tool operations', () => {
  test('add returns the assigned id; a repeat converges to the same row', async () => {
    const f = await setup({ onboarded: true });
    const first = await addPrompt(f.env, f.principal, f.workspace, {
      text: 'which tools track AI visibility?',
      category: 'Comparison' as never,
    });
    expect(first).toMatchObject({ ok: true, duplicated: false });
    const repeat = await addPrompt(f.env, f.principal, f.workspace, {
      text: 'which tools track AI visibility?',
    });
    expect(repeat).toMatchObject({
      ok: true,
      duplicated: true,
      prompt: { id: first.ok ? first.prompt.id : -1, category: 'Comparison' },
    });
  });

  test('add classifies the cohort from the text and returns the resolved kind', async () => {
    const f = await setup({ onboarded: true });
    await f.db.insert(entities).values({
      id: 50,
      workspaceId: 9,
      name: 'Brand',
      domains: ['brand.example'],
      aliases: [],
      isBrand: true,
      sortOrder: 0,
    });
    const brandNamed = await addPrompt(f.env, f.principal, f.workspace, {
      text: 'is Brand good for tracking AI visibility?',
    });
    expect(brandNamed).toMatchObject({
      ok: true,
      prompt: { kind: 'brand_defining' },
    });
    const open = await addPrompt(f.env, f.principal, f.workspace, {
      text: 'which tools track AI visibility?',
    });
    expect(open).toMatchObject({ ok: true, prompt: { kind: 'discovery' } });
  });

  test('an explicit kind wins over the classifier and update can change it', async () => {
    const f = await setup({ onboarded: true });
    await f.db.insert(entities).values({
      id: 50,
      workspaceId: 9,
      name: 'Brand',
      domains: ['brand.example'],
      aliases: [],
      isBrand: true,
      sortOrder: 0,
    });
    const created = await addPrompt(f.env, f.principal, f.workspace, {
      text: 'is Brand good for tracking AI visibility?',
      kind: 'discovery',
    });
    expect(created).toMatchObject({ ok: true, prompt: { kind: 'discovery' } });
    const id = created.ok ? created.prompt.id : -1;
    const updated = await updatePrompt(f.env, f.principal, f.workspace, {
      promptId: id,
      kind: 'brand_defining',
    });
    expect(updated).toMatchObject({
      ok: true,
      prompt: { kind: 'brand_defining' },
    });
  });

  test('add enforces the standard 25-prompt ceiling but not the admin one', async () => {
    const f = await setup({ onboarded: true });
    for (let i = 0; i < 25; i += 1) {
      const created = await addPrompt(f.env, f.principal, f.workspace, {
        text: `standard question ${i}?`,
      });
      expect(created.ok).toBe(true);
    }
    const refused = await addPrompt(f.env, f.principal, f.workspace, {
      text: 'one question too many?',
    });
    expect(refused).toMatchObject({ error: { code: 'prompt_limit' } });

    const admin = await setup({
      onboarded: true,
      adminEmails: 'owner@example.com',
    });
    for (let i = 0; i < 26; i += 1) {
      const created = await addPrompt(
        admin.env,
        admin.principal,
        admin.workspace,
        {
          text: `admin question ${i}?`,
        },
      );
      expect(created.ok).toBe(true);
    }
  });

  test('list reports ids, categories, activity, answers, and the limit', async () => {
    const f = await setup({ onboarded: true });
    const id = await seedPrompt(f.db, 9, 'tracked question?', ['Discovery']);
    const listed = await listPrompts(f.env, f.principal, f.workspace);
    expect(listed).toMatchObject({
      ok: true,
      limit: 25,
      activePrompts: 1,
      totalPrompts: 1,
      categories: expect.arrayContaining(['Discovery']),
    });
    expect(listed.prompts[0]).toMatchObject({
      id,
      category: 'Discovery',
      active: true,
      answers: 0,
    });
  });

  test('update rewords text and folds category into the single tag', async () => {
    const f = await setup({ onboarded: true });
    const id = await seedPrompt(f.db, 9, 'before question?', ['Discovery']);
    const updated = await updatePrompt(f.env, f.principal, f.workspace, {
      promptId: id,
      text: 'after question?',
      category: 'Decision' as never,
    });
    expect(updated).toMatchObject({
      ok: true,
      prompt: { id, text: 'after question?', category: 'Decision' },
    });
    const duplicate = await updatePrompt(f.env, f.principal, f.workspace, {
      promptId: id,
      text: 'after question?',
    });
    expect(duplicate).toMatchObject({ ok: true });
  });

  test('toggle flips activity and refuses an activation over the ceiling', async () => {
    const f = await setup({ onboarded: true });
    const parked = await seedPrompt(f.db, 9, 'parked question?', [], false);
    const full = await seedPrompt(f.db, 9, 'fills the ceiling?');
    const on = await togglePrompt(f.env, f.principal, f.workspace, {
      promptId: parked,
      active: true,
    });
    expect(on).toMatchObject({ ok: true, prompt: { active: true } });
    const off = await togglePrompt(f.env, f.principal, f.workspace, {
      promptId: on.ok && on.prompt.active ? parked : -1,
      active: false,
    });
    expect(off).toMatchObject({ ok: true, prompt: { active: false } });
    expect(full).toBeGreaterThan(0);
  });

  test('remove retires a prompt with history and deletes one without', async () => {
    const f = await setup({ onboarded: true });
    const unused = await seedPrompt(f.db, 9, 'fresh question?');
    const deleted = await removePromptTool(f.env, f.principal, f.workspace, {
      promptId: unused,
    });
    expect(deleted).toMatchObject({ ok: true, action: 'deleted' });
    const rows = await f.db.select().from(prompts);
    expect(rows).toHaveLength(0);
  });

  test('remove of an unknown id reports not_found', async () => {
    const f = await setup({ onboarded: true });
    const result = await removePromptTool(f.env, f.principal, f.workspace, {
      promptId: 424242,
    });
    expect(result).toMatchObject({ error: { code: 'not_found' } });
  });
});

describe('competitor tools', () => {
  test('add assigns an id after the brand; duplicate names are refused', async () => {
    const f = await setup({ onboarded: true });
    const created = await addCompetitor(f.env, f.principal, f.workspace, {
      name: 'Rival',
      domains: ['rival.example'],
      aliases: [{ value: 'Rivalry', caseSensitive: false }],
    });
    expect(created).toMatchObject({
      ok: true,
      entity: { name: 'Rival', domains: ['rival.example'] },
    });
    const brandClash = await addCompetitor(f.env, f.principal, f.workspace, {
      name: 'rival',
      domains: ['other.example'],
      aliases: [],
    });
    expect(brandClash).toMatchObject({ error: { code: 'duplicate_name' } });
  });

  test('remove works by name, refuses the brand and scored competitors', async () => {
    const f = await setup({ onboarded: true });
    const competitor = await addCompetitor(f.env, f.principal, f.workspace, {
      name: 'Rival',
      domains: ['rival.example'],
      aliases: [],
    });
    expect(competitor.ok).toBe(true);
    const removed = await removeCompetitor(f.env, f.principal, f.workspace, {
      name: 'rival',
    });
    expect(removed).toMatchObject({ ok: true, removed: 'Rival' });

    const scored = await addCompetitor(f.env, f.principal, f.workspace, {
      name: 'Entrenched',
      domains: ['entrenched.example'],
      aliases: [],
    });
    expect(scored.ok).toBe(true);
    if (!scored.ok) {
      return;
    }
    await db_history(f.db, scored.entity.id);
    const refused = await removeCompetitor(f.env, f.principal, f.workspace, {
      name: 'Entrenched',
    });
    expect(refused).toMatchObject({ error: { code: 'has_history' } });
    await f.db.insert(entities).values({
      id: 50,
      workspaceId: 9,
      name: 'Brand',
      domains: ['brand.example'],
      aliases: [],
      isBrand: true,
      sortOrder: 0,
    });
    const brand = await removeCompetitor(f.env, f.principal, f.workspace, {
      name: 'Brand',
    });
    expect(brand).toMatchObject({ error: { code: 'is_brand' } });
  });

  test('list returns competitors with ids and excludes the brand', async () => {
    const f = await setup({ onboarded: true });
    await addCompetitor(f.env, f.principal, f.workspace, {
      name: 'Rival',
      domains: ['rival.example'],
      aliases: [],
    });
    const list = await listCompetitors(f.env, f.principal, f.workspace);
    expect(list.competitors).toEqual([
      {
        id: expect.any(Number),
        name: 'Rival',
        domains: ['rival.example'],
        aliases: [],
      },
    ]);
  });
});

describe('surface tools', () => {
  test('enable and disable update the stored set in canonical order', async () => {
    const f = await setup({
      onboarded: true,
      adminEmails: 'owner@example.com',
    });
    const off = await setSurfaceEnabled(
      f.env,
      f.principal,
      f.workspace,
      'perplexity',
      false,
    );
    expect(off).toMatchObject({
      ok: true,
      changed: 'perplexity',
      surfaces: ['chatgpt', 'gemini', 'google_ai_mode', 'google_aio'],
    });
    const on = await setSurfaceEnabled(
      f.env,
      f.principal,
      f.workspace,
      'perplexity',
      true,
    );
    expect(on).toMatchObject({
      ok: true,
      surfaces: [
        'chatgpt',
        'perplexity',
        'gemini',
        'google_ai_mode',
        'google_aio',
      ],
    });
  });

  test('a standard user is capped; the last surface cannot be disabled', async () => {
    const f = await setup({ onboarded: true });
    const capped = await setSurfaceEnabled(
      f.env,
      f.principal,
      f.workspace,
      'google_ai_mode',
      true,
    );
    expect(capped).toMatchObject({ error: { code: 'surface_limit' } });
    for (const surface of ['chatgpt', 'perplexity'] as const) {
      await setSurfaceEnabled(f.env, f.principal, f.workspace, surface, false);
    }
    const last = await setSurfaceEnabled(
      f.env,
      f.principal,
      f.workspace,
      'gemini',
      false,
    );
    expect(last).toMatchObject({ error: { code: 'last_surface' } });
  });
});

describe('run_now operation', () => {
  test('a non-operator principal is refused before anything runs', async () => {
    const f = await setup({ onboarded: true });
    await seedPrompt(f.db, 9, 'some question?');
    await expect(runNow(f.env, f.principal, f.workspace, {})).rejects.toThrow(
      'administrator accounts',
    );
    expect(f.sent).toHaveLength(0);
    const runRows = await f.db.select().from(runs);
    expect(runRows).toHaveLength(0);
  });

  test('an operator triggers a manual run over the current active set', async () => {
    const f = await setup({
      onboarded: true,
      adminEmails: 'owner@example.com',
    });
    await seedPrompt(f.db, 9, 'active question one?');
    await seedPrompt(f.db, 9, 'parked question two?', [], false);
    const result = await runNow(f.env, f.principal, f.workspace, {});
    expect(result).toMatchObject({
      ok: true,
      run: { created: true, totalCount: 5, dispatchState: 'dispatched' },
    });
    expect(f.sent.length).toBeGreaterThan(0);
    const runRows = await f.db.select().from(runs);
    expect(runRows).toHaveLength(1);
    expect(runRows[0]?.trigger).toBe('manual');
  });

  test('refuses a run with no active prompts', async () => {
    const f = await setup({
      onboarded: true,
      adminEmails: 'owner@example.com',
    });
    const result = await runNow(f.env, f.principal, f.workspace, {});
    expect(result).toMatchObject({ error: { code: 'no_active_prompts' } });
  });

  test('the fifth manual run in an hour still starts; the sixth is refused', async () => {
    const f = await setup({
      onboarded: true,
      adminEmails: 'owner@example.com',
    });
    await seedPrompt(f.db, 9, 'repeated question?');
    for (let i = 0; i < 5; i += 1) {
      const result = await runNow(f.env, f.principal, f.workspace, {});
      expect(result.ok).toBe(true);
    }
    const sixth = await runNow(f.env, f.principal, f.workspace, {});
    expect(sixth).toMatchObject({ error: { code: 'manual_run_limit' } });
  });
});
