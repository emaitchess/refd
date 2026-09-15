import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import type { Db } from '../db/client';
import * as schema from '../db/schema';
import {
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

const batchFor = (body: IngestMessage) =>
  ({
    queue: 'refd-ingest',
    messages: [
      {
        body,
        attempts: 1,
        ack: () => {},
        retry: () => {},
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
});
