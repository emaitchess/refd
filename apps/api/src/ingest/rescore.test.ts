import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import type { Db } from '../db/client';
import * as schema from '../db/schema';
import {
  entityScores,
  prompts,
  results,
  runs,
  users,
  workspaces,
} from '../db/schema';
import { rescoreProgress } from './rescore';

// Same sqlite-as-D1 harness as consumer.test.ts: migrations run as real SQL,
// so rescoreProgress's nested subselects execute for real.
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
];

const setup = async (): Promise<Db> => {
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
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  await db.insert(users).values({
    id: 1,
    email: 'owner@example.com',
    passwordHash: 'x',
    salt: 'x',
  });
  await db.insert(workspaces).values({ id: 9, name: 'ws', ownerUserId: 1 });
  await db.insert(runs).values({
    id: 60,
    workspaceId: 9,
    key: 'cron:9:2026-09-15',
    date: '2026-09-15',
    trigger: 'cron',
    status: 'complete',
  });
  await db.insert(prompts).values({ id: 86, workspaceId: 9, text: 'p86' });
  return db;
};

describe('rescoreProgress', () => {
  test('counts stale scores and the sentiment backlog over scoreable results', async () => {
    const db = await setup();
    const inserted = await db
      .insert(results)
      .values([
        // A: has raw, one stale v0 score with no label → stale + pending.
        {
          runId: 60,
          promptId: 86,
          surface: 'chatgpt',
          sample: 1,
          provider: 'brightdata',
          ok: true,
          answerPresent: true,
          r2Key: 'raw/60/86-chatgpt-1.json.gz',
          totalUrls: 0,
        },
        // B: no raw — outside every rescore denominator.
        {
          runId: 60,
          promptId: 86,
          surface: 'gemini',
          sample: 1,
          provider: 'brightdata',
          ok: true,
          answerPresent: true,
          r2Key: null,
          totalUrls: 0,
        },
        // C: current scores (not stale) but sentiment never landed.
        {
          runId: 60,
          promptId: 86,
          surface: 'perplexity',
          sample: 1,
          provider: 'brightdata',
          ok: true,
          answerPresent: true,
          r2Key: 'raw/60/86-perplexity-1.json.gz',
          totalUrls: 0,
        },
      ])
      .returning({ id: results.id });
    const [a, c] = inserted.map((row) => row.id);
    if (a === undefined || c === undefined) {
      throw new Error('fixture results missing');
    }
    await db.insert(entityScores).values([
      {
        resultId: a,
        entityId: 100,
        mentioned: true,
        mentionCount: 1,
        firstOffset: 0,
        spans: [{ start: 0, end: 4 }],
        cited: false,
        citedCount: 0,
        position: 1,
        prominence: 'lead' as const,
        sentiment: null,
        scoringVersion: 0,
      },
      {
        resultId: a,
        entityId: 101,
        mentioned: true,
        mentionCount: 1,
        firstOffset: 9,
        spans: [{ start: 9, end: 15 }],
        cited: false,
        citedCount: 0,
        position: 2,
        prominence: 'lead' as const,
        sentiment: 'positive' as const,
        scoringVersion: 1,
      },
      {
        resultId: c,
        entityId: 101,
        mentioned: true,
        mentionCount: 1,
        firstOffset: 0,
        spans: [{ start: 0, end: 6 }],
        cited: false,
        citedCount: 0,
        position: 1,
        prominence: 'lead' as const,
        sentiment: null,
        scoringVersion: 1,
      },
    ]);

    const progress = await rescoreProgress(db, 9);
    expect(progress.total).toBe(2);
    expect(progress.stale).toBe(1);
    expect(progress.sentimentPending).toBe(2);
  });
});
