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
  snapshots,
  users,
  workspaces,
} from '../db/schema';
import type { AppEnv } from '../env';
import {
  handleIngestBatch,
  isQueueOverload,
  resumeTerminalSnapshot,
} from './consumer';
import type { IngestMessage } from './messages';

// Migrations applied to an in-memory SQLite so the terminal-snapshot reset
// runs as real conditional SQL, not mocks.
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

// bun:sqlite facade speaking the D1 API for the consumer handlers, which build
// their own drizzle from env.DB (drizzle-orm/d1). Same three-call shape the
// agent-tools tests use.
let lastD1: unknown = null;

const makeD1 = (sqlite: Database) => ({
  prepare: (query: string) => {
    const stmt = sqlite.prepare(query);
    const all = stmt.all.bind(stmt) as (
      ...params: unknown[]
    ) => Record<string, unknown>[];
    const runStmt = stmt.run.bind(stmt) as (...params: unknown[]) => {
      changes: number;
      lastInsertRowid: number | bigint;
    };
    return {
      bind: (...params: unknown[]) => ({
        all: async () => ({ results: all(...params) }),
        first: async () => all(...params)[0] ?? null,
        run: async () => {
          const info = runStmt(...params);
          return {
            success: true,
            meta: { changes: info.changes, last_row_id: info.lastInsertRowid },
          };
        },
        raw: async () => all(...params).map((row) => Object.values(row)),
      }),
    };
  },
});

const setup = async (): Promise<Db> => {
  const sqlite = new Database(':memory:');
  lastD1 = makeD1(sqlite);
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
  await db.insert(prompts).values([
    { id: 86, workspaceId: 9, text: 'p86' },
    { id: 87, workspaceId: 9, text: 'p87' },
  ]);
  return db;
};

const insertSnapshot = async (db: Db): Promise<number> => {
  const rows = await db
    .insert(snapshots)
    .values({
      runId: 60,
      provider: 'brightdata',
      surface: 'google_ai_mode',
      sample: 1,
      chunk: 3,
      promptIds: [86, 87],
      promptSnapshot: [
        { id: 86, text: 'p86' },
        { id: 87, text: 'p87' },
      ],
      externalId: 'sd_existing',
    })
    .returning({ id: snapshots.id });
  return rows[0]?.id ?? 0;
};

const snapshotOf = async (db: Db) =>
  (await db.select().from(snapshots).where(eq(snapshots.runId, 60)))[0];

describe('isQueueOverload', () => {
  test('matches the Cloudflare Queues backpressure error', () => {
    expect(
      isQueueOverload(
        new Error('Queue is overloaded. Please back off. (10250)'),
      ),
    ).toBe(true);
  });

  test('does not match provider or transport failures', () => {
    expect(
      isQueueOverload(
        new Error(
          'brightdata 400 on trigger perplexity: Customer is not active',
        ),
      ),
    ).toBe(false);
    expect(isQueueOverload(new Error('Network connection lost.'))).toBe(false);
  });

  test('tolerates a non-Error throw', () => {
    expect(isQueueOverload('Queue is overloaded')).toBe(true);
    expect(isQueueOverload(undefined)).toBe(false);
  });
});

describe('resumeTerminalSnapshot', () => {
  test('resets a failed snapshot so a recover re-trigger can resume the fetch', async () => {
    const db = await setup();
    const id = await insertSnapshot(db);
    await db
      .update(snapshots)
      .set({ status: 'failed', finishedAt: 1757917387000, polls: 0 })
      .where(eq(snapshots.id, id));

    await resumeTerminalSnapshot(db, id);

    const row = await snapshotOf(db);
    expect(row?.status).toBe('triggered');
    expect(row?.finishedAt).toBeNull();
    expect(row?.externalId).toBe('sd_existing');
    expect(row?.promptSnapshot).toHaveLength(2);
  });

  test('resets a ready snapshot with missing results the same way', async () => {
    const db = await setup();
    const id = await insertSnapshot(db);
    await db
      .update(snapshots)
      .set({ status: 'ready', finishedAt: 1757917387000 })
      .where(eq(snapshots.id, id));

    await resumeTerminalSnapshot(db, id);

    const row = await snapshotOf(db);
    expect(row?.status).toBe('triggered');
    expect(row?.finishedAt).toBeNull();
  });

  test('leaves an in-flight triggered snapshot untouched', async () => {
    const db = await setup();
    const id = await insertSnapshot(db);

    await resumeTerminalSnapshot(db, id);

    const row = await snapshotOf(db);
    expect(row?.status).toBe('triggered');
    expect(row?.finishedAt).toBeNull();
  });
});

const batchFor = (body: IngestMessage, retries: unknown[] = []) =>
  ({
    queue: 'refd-ingest',
    messages: [
      {
        body,
        attempts: 1,
        ack: () => {},
        retry: (opts?: { delaySeconds?: number }) => {
          retries.push(opts ?? {});
        },
      },
    ],
  }) as unknown as Parameters<typeof handleIngestBatch>[0];

describe('handleDelivered', () => {
  const seedDelivery = async (db: Db) => {
    await db.insert(snapshots).values({
      runId: 60,
      provider: 'brightdata',
      surface: 'chatgpt',
      sample: 1,
      chunk: 0,
      promptIds: [86, 87],
      promptSnapshot: [
        { id: 86, text: 'p86' },
        { id: 87, text: 'p87' },
      ],
      externalId: 'sd_delivered',
    });
  };

  const deliveryMessage = (key: string): IngestMessage => ({
    kind: 'brightdata_delivered',
    runId: 60,
    workspaceId: 9,
    surface: 'chatgpt',
    sample: 1,
    chunk: 0,
    snapshotId: 'sd_delivered',
    deliveryKey: key,
    prompts: [
      { id: 86, text: 'p86' },
      { id: 87, text: 'p87' },
    ],
  });

  test('stores gzipped records from the stashed object and marks the snapshot ready', async () => {
    const db = await setup();
    const sent: IngestMessage[] = [];
    const records = [
      { prompt: 'p86', answer_text: 'refd tracks visibility' },
      { prompt: 'p87', answer_text: 'also visibility' },
    ];
    const gz = Bun.gzipSync(Buffer.from(JSON.stringify(records)));
    const gzBytes = new Uint8Array(gz);
    const fakeEnv = {
      DB: lastD1,
      RAW: {
        get: async () => ({
          arrayBuffer: async () => gzBytes.buffer,
          body: new Blob([gzBytes]).stream(),
        }),
        put: async () => ({}),
      },
      INGEST: {
        send: async (message: IngestMessage) => {
          sent.push(message);
        },
        sendBatch: async (batch: { body: IngestMessage }[]) => {
          sent.push(...batch.map((message) => message.body));
        },
      },
    } as unknown as AppEnv;
    await seedDelivery(db);

    await handleIngestBatch(
      batchFor(deliveryMessage('deliveries/sd/data.json.gz')),
      fakeEnv,
    );

    const stored = await db.select().from(results);
    expect(stored).toHaveLength(2);
    expect(stored.every((row) => Boolean(row.ok))).toBe(true);
    const row = await snapshotOf(db);
    expect(row?.status).toBe('ready');
    expect(row?.finishedAt).not.toBeNull();
  });

  test('a missing delivery object is retryable, not a prompt failure', async () => {
    const db = await setup();
    const sent: IngestMessage[] = [];
    const env = {
      DB: lastD1,
      RAW: {
        get: async () => null,
      },
      INGEST: {
        send: async () => {},
        sendBatch: async () => {},
      },
    } as unknown as AppEnv;
    await seedDelivery(db);

    await handleIngestBatch(batchFor(deliveryMessage('deliveries/gone')), env);

    expect(sent).toEqual([]);
  });

  const deliveryEnv = (records: Record<string, unknown>[]): AppEnv => {
    const gz = Bun.gzipSync(Buffer.from(JSON.stringify(records)));
    const gzBytes = new Uint8Array(gz);
    return {
      DB: lastD1,
      RAW: {
        get: async () => ({
          arrayBuffer: async () => gzBytes.buffer,
          body: new Blob([gzBytes]).stream(),
        }),
        put: async () => ({}),
      },
      INGEST: {
        send: async () => {},
        sendBatch: async () => {},
      },
    } as unknown as AppEnv;
  };

  test('a provider error record fails only its own prompt', async () => {
    const db = await setup();
    await seedDelivery(db);
    await handleIngestBatch(
      batchFor(deliveryMessage('deliveries/sd/data.json.gz')),
      deliveryEnv([
        { prompt: 'p86', error: 'upstream timeout' },
        { prompt: 'p87', answer_text: 'visibility for p87' },
      ]),
    );

    const stored = await db.select().from(results);
    expect(stored).toHaveLength(2);
    const failed = stored.find((row) => row.promptId === 86);
    const good = stored.find((row) => row.promptId === 87);
    expect(failed?.ok).toBe(false);
    expect(failed?.error).toContain('provider record error: upstream timeout');
    expect(good?.ok).toBe(true);
  });

  test('a record with no answer text fails as drift, never a silent zero', async () => {
    const db = await setup();
    await seedDelivery(db);
    // p86's record carries citations but no recognized answer field: a
    // pre-guard ingest would have stored ok=true with zero mentions and
    // deflated every mention rate.
    await handleIngestBatch(
      batchFor(deliveryMessage('deliveries/sd/data.json.gz')),
      deliveryEnv([
        { prompt: 'p86', citations: [{ url: 'https://example.com/x' }] },
        { prompt: 'p87', answer_text: 'visibility for p87' },
      ]),
    );

    const stored = await db.select().from(results);
    expect(stored).toHaveLength(2);
    const drifted = stored.find((row) => row.promptId === 86);
    const good = stored.find((row) => row.promptId === 87);
    expect(drifted?.ok).toBe(false);
    expect(drifted?.error).toContain('empty answer text');
    expect(good?.ok).toBe(true);
  });

  test('redelivery never duplicates results', async () => {
    const db = await setup();
    await seedDelivery(db);
    const records = [
      { prompt: 'p86', answer_text: 'refd tracks visibility' },
      { prompt: 'p87', answer_text: 'also visibility' },
    ];
    const message = batchFor(deliveryMessage('deliveries/sd/data.json.gz'));
    await handleIngestBatch(message, deliveryEnv(records));
    await handleIngestBatch(message, deliveryEnv(records));

    const stored = await db.select().from(results);
    expect(stored).toHaveLength(2);
    expect(stored.every((row) => Boolean(row.ok))).toBe(true);
    const row = await snapshotOf(db);
    expect(row?.status).toBe('ready');
  });
});

// A verdict generator keyed to whatever numbered roster the model sees, so
// head/tail split behavior is observable through which calls happened.
const aiFromRoster = (calls: unknown[]) => ({
  AI: {
    run: async (model: string, input: unknown) => {
      calls.push({ model, input });
      const user = (
        input as { messages: { role: string; content: string }[] }
      ).messages.find((m) => m.role === 'user')?.content;
      const list = user?.slice(
        user.indexOf('Entities:'),
        user.indexOf('\n\nAnswer:'),
      );
      const names = (list ?? '')
        .split('\n')
        .slice(1)
        .filter((line) => line.trim().length > 0);
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                sentiments: names.map((_, i) => ({
                  entity: i + 1,
                  sentiment: 'neutral',
                })),
              }),
            },
          },
        ],
      };
    },
  },
});

describe('handleSentiment', () => {
  const seedMentioned = async (
    db: Db,
    offsets: { entityId: number; firstOffset: number; name: string }[],
  ) => {
    await db.insert(entities).values(
      offsets.map((e) => ({
        id: e.entityId,
        workspaceId: 9,
        name: e.name,
        domains: [`${e.name}.example`],
        aliases: [],
        isBrand: false,
        sortOrder: 0,
      })),
    );
    const inserted = await db
      .insert(results)
      .values({
        runId: 60,
        promptId: 86,
        surface: 'chatgpt',
        sample: 1,
        provider: 'brightdata',
        ok: true,
        answerPresent: true,
        r2Key: 'raw/60/86-chatgpt-1.json.gz',
        totalUrls: 0,
      })
      .returning({ id: results.id });
    const resultId = inserted[0]?.id ?? 0;
    await db.insert(entityScores).values(
      offsets.map((e) => ({
        resultId,
        entityId: e.entityId,
        mentioned: true,
        mentionCount: 1,
        firstOffset: e.firstOffset,
        spans: [{ start: e.firstOffset, end: e.firstOffset + 4 }],
        cited: false,
        citedCount: 0,
        position: 1,
        prominence: 'lead' as const,
        sentiment: null,
        scoringVersion: 1,
      })),
    );
    return resultId;
  };

  const sentimentEnv = (
    rawText: string,
    calls: unknown[],
    sent: IngestMessage[],
  ): AppEnv =>
    ({
      DB: lastD1,
      RAW: {
        get: async () => ({
          body: new Blob([
            Bun.gzipSync(Buffer.from(JSON.stringify({ answer_text: rawText }))),
          ]).stream(),
        }),
        put: async () => ({}),
      },
      ...aiFromRoster(calls),
      INGEST: {
        send: async (message: IngestMessage) => {
          sent.push(message);
        },
        sendBatch: async (batch: { body: IngestMessage }[]) => {
          sent.push(...batch.map((message) => message.body));
        },
      },
    }) as unknown as AppEnv;

  test('classifies every mentioned entity and writes only mentioned rows', async () => {
    const db = await setup();
    const resultId = await seedMentioned(db, [
      { entityId: 100, firstOffset: 0, name: 'mrmr' },
      { entityId: 101, firstOffset: 12, name: 'Dottie' },
    ]);
    const calls: unknown[] = [];
    const sent: IngestMessage[] = [];

    await handleIngestBatch(
      batchFor({ kind: 'sentiment_score', workspaceId: 9, resultId }),
      sentimentEnv('mrmr leads, then Dottie trails.', calls, sent),
    );

    expect(calls).toHaveLength(1);
    const rows = await db.select().from(entityScores);
    expect(rows.every((row) => row.sentiment === 'neutral')).toBe(true);
    expect(sent).toEqual([]);
  });

  test('the roster grounds alias matches with the span the matcher found', async () => {
    const db = await setup();
    // Entity named Profound, matched in the answer via its domain alias
    // starting at offset 6 ('every ' precedes it).
    const resultId = await seedMentioned(db, [
      { entityId: 100, firstOffset: 6, name: 'Profound' },
    ]);
    await db
      .update(entityScores)
      .set({ spans: [{ start: 6, end: 22 }] })
      .where(eq(entityScores.resultId, resultId));
    const calls: unknown[] = [];
    const sent: IngestMessage[] = [];

    await handleIngestBatch(
      batchFor({ kind: 'sentiment_score', workspaceId: 9, resultId }),
      sentimentEnv(
        'every trypro\nfound.com alternative fails this test',
        calls,
        sent,
      ),
    );

    const user = (
      calls[0] as {
        input: { messages: { role: string; content: string }[] };
      }
    ).input.messages.find((m) => m.role === 'user')?.content as string;
    // The span slices stored text, so a drifted span must not inject raw
    // newlines into the numbered roster.
    expect(user).toContain('1. Profound (appears as "trypro found.com")');
  });

  test('an empty span contributes no roster marker', async () => {
    const db = await setup();
    const resultId = await seedMentioned(db, [
      { entityId: 100, firstOffset: 0, name: 'Profound' },
    ]);
    await db
      .update(entityScores)
      .set({ spans: [{ start: 0, end: 0 }] })
      .where(eq(entityScores.resultId, resultId));
    const calls: unknown[] = [];
    const sent: IngestMessage[] = [];

    await handleIngestBatch(
      batchFor({ kind: 'sentiment_score', workspaceId: 9, resultId }),
      sentimentEnv('nothing here', calls, sent),
    );

    const user = (
      calls[0] as {
        input: { messages: { role: string; content: string }[] };
      }
    ).input.messages.find((m) => m.role === 'user')?.content as string;
    expect(user).toContain('1. Profound\n');
    expect(user).not.toContain('appears as');
  });

  test('unparseable output retries instead of acking nulls', async () => {
    const db = await setup();
    const resultId = await seedMentioned(db, [
      { entityId: 100, firstOffset: 0, name: 'mrmr' },
    ]);
    const calls: unknown[] = [];
    const sent: IngestMessage[] = [];
    const env = {
      ...sentimentEnv('mrmr leads.', calls, sent),
      AI: {
        run: async () => ({ choices: [{ message: { content: 'nope' } }] }),
      },
    } as unknown as AppEnv;
    const retries: unknown[] = [];

    await handleIngestBatch(
      batchFor({ kind: 'sentiment_score', workspaceId: 9, resultId }, retries),
      env,
    );

    expect(retries.length).toBeGreaterThan(0);
    const rows = await db.select().from(entityScores);
    expect(rows.every((row) => row.sentiment === null)).toBe(true);
  });

  test('an entity first-mentioned beyond the prompt window gets a tail pass', async () => {
    const db = await setup();
    const filler = 'x'.repeat(12000);
    const text = `Dottie leads. ${filler} and mrmr named deep in the answer.`;
    const resultId = await seedMentioned(db, [
      { entityId: 100, firstOffset: text.indexOf('mrmr'), name: 'mrmr' },
      { entityId: 101, firstOffset: 0, name: 'Dottie' },
    ]);
    const calls: unknown[] = [];
    const sent: IngestMessage[] = [];

    await handleIngestBatch(
      batchFor({ kind: 'sentiment_score', workspaceId: 9, resultId }),
      sentimentEnv(text, calls, sent),
    );

    expect(calls).toHaveLength(2);
    const rows = await db.select().from(entityScores);
    expect(
      rows.every((row) => row.entityId === 100 || row.entityId === 101),
    ).toBe(true);
    expect(rows.every((row) => row.sentiment === 'neutral')).toBe(true);
    // The head call must not have carried the tail entity: the two calls see
    // disjoint rosters.
    const tailUser = (
      calls[1] as {
        input: { messages: { role: string; content: string }[] };
      }
    ).input.messages.find((m) => m.role === 'user')?.content;
    expect(tailUser).toContain('mrmr');
    expect(tailUser).not.toContain('Dottie');
  });

  test('entities far past one tail window get additional windows', async () => {
    const db = await setup();
    // mrmr just past the main window; Otterly ~12k past mrmr — the first
    // tail window (anchored at mrmr) cannot reach it.
    const filler1 = 'x'.repeat(12050);
    const filler2 = 'y'.repeat(12000);
    const head = 'Dottie leads. ';
    const text = `${head}${filler1} and mrmr midway, ${filler2} then Otterly last.`;
    const resultId = await seedMentioned(db, [
      { entityId: 100, firstOffset: text.indexOf('mrmr'), name: 'mrmr' },
      { entityId: 101, firstOffset: 0, name: 'Dottie' },
      { entityId: 102, firstOffset: text.indexOf('Otterly'), name: 'Otterly' },
    ]);
    const calls: unknown[] = [];
    const sent: IngestMessage[] = [];

    await handleIngestBatch(
      batchFor({ kind: 'sentiment_score', workspaceId: 9, resultId }),
      sentimentEnv(text, calls, sent),
    );

    expect(calls).toHaveLength(3);
    const rows = await db.select().from(entityScores);
    expect(rows.every((row) => row.sentiment === 'neutral')).toBe(true);
    // Each call sees a disjoint roster: head has Dottie only, first tail
    // window mrmr only, second tail window Otterly only.
    const rosters = calls.map((call) =>
      (
        (
          call as {
            input: { messages: { role: string; content: string }[] };
          }
        ).input.messages.find((m) => m.role === 'user')?.content ?? ''
      ).slice(0, 60),
    );
    expect(rosters[0]).toContain('Dottie');
    expect(rosters[0]).not.toContain('mrmr');
    expect(rosters[1]).toContain('mrmr');
    expect(rosters[1]).not.toContain('Otterly');
    expect(rosters[2]).toContain('Otterly');
  });
});

describe('handleRescoreBatch', () => {
  test('a lifted result with mentions re-drives classification, carry-over labels skip', async () => {
    const db = await setup();
    await db.insert(entities).values({
      id: 100,
      workspaceId: 9,
      name: 'mrmr',
      domains: ['getmrmr.com'],
      aliases: [],
      isBrand: true,
      sortOrder: 0,
    });
    const inserted = await db
      .insert(results)
      .values({
        runId: 60,
        promptId: 86,
        surface: 'chatgpt',
        sample: 1,
        provider: 'brightdata',
        ok: true,
        answerPresent: true,
        r2Key: 'raw/60/86-chatgpt-1.json.gz',
        totalUrls: 0,
      })
      .returning({ id: results.id });
    const resultId = inserted[0]?.id ?? 0;
    // Stale v0 rows the backfill exists to lift.
    await db.insert(entityScores).values({
      resultId,
      entityId: 100,
      mentioned: true,
      mentionCount: 1,
      firstOffset: 0,
      spans: [{ start: 0, end: 4 }],
      cited: false,
      citedCount: 0,
      position: 1,
      prominence: 'lead',
      sentiment: null,
      scoringVersion: 0,
    });
    const calls: unknown[] = [];
    const sent: IngestMessage[] = [];
    const env = {
      DB: lastD1,
      RAW: {
        get: async () => ({
          body: new Blob([
            Bun.gzipSync(
              Buffer.from(
                JSON.stringify({ answer_text: 'mrmr leads this list.' }),
              ),
            ),
          ]).stream(),
        }),
        put: async () => ({}),
      },
      ...aiFromRoster(calls),
      INGEST: {
        send: async (message: IngestMessage) => {
          sent.push(message);
        },
        sendBatch: async (batch: { body: IngestMessage }[]) => {
          sent.push(...batch.map((message) => message.body));
        },
      },
    } as unknown as AppEnv;

    await handleIngestBatch(
      batchFor({ kind: 'rescore_batch', workspaceId: 9, afterResultId: 0 }),
      env,
    );

    const rescored = await db.select().from(entityScores);
    expect(rescored.every((row) => row.scoringVersion === 1)).toBe(true);
    expect(rescored.every((row) => row.mentioned)).toBe(true);
    expect(sent).toContainEqual({
      kind: 'sentiment_score',
      workspaceId: 9,
      resultId,
    });
    // The chained follow-up classifies the lifted rows.
    const sentiment = sent[0];
    if (sentiment?.kind !== 'sentiment_score') {
      throw new Error('expected a sentiment follow-up');
    }
    await handleIngestBatch(batchFor(sentiment, []), env);
    const labeled = await db.select().from(entityScores);
    expect(labeled.every((row) => row.sentiment === 'neutral')).toBe(true);
  });
});
