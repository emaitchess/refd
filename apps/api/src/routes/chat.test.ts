import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { citedSourceNumbers, parseToolCall } from '../chat/exchange';
import {
  acceptExchange,
  commitExchangeAnswer,
  commitExchangeFailure,
} from '../chat/lifecycle';
import type { Db } from '../db/client';
import type { AppEnv } from '../env';
import { provisionWorkspace } from '../lib/workspace-provision';
import { agentTool } from './tool-registry';
import { claimWorkspaceDeletion } from './workspaces';

const getPromptResults = agentTool('get_prompt_results');
if (!getPromptResults) {
  throw new Error('get_prompt_results must be declared');
}

describe('parseToolCall', () => {
  test('parses and validates a well-formed call', () => {
    const parsed = parseToolCall(
      getPromptResults,
      '{"prompt":"best voice control apps for macOS"}',
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(JSON.stringify(parsed.args)).toBe(
        '{"prompt":"best voice control apps for macOS"}',
      );
    }
  });

  test('invalid JSON fails cleanly instead of throwing', () => {
    const parsed = parseToolCall(getPromptResults, 'not json');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.length).toBeGreaterThan(0);
    }
  });

  test('arguments of the wrong shape fail validation instead of throwing', () => {
    const parsed = parseToolCall(getPromptResults, '{"wrong":"field"}');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toContain('prompt');
    }
  });

  // z.object strips unknown keys by default, so an over-eager extra argument
  // is harmless: the call runs on the fields the schema declares.
  test('an unknown extra key is stripped, not rejected', () => {
    const parsed = parseToolCall(
      getPromptResults,
      '{"prompt":"best voice control apps for macOS","extra":1}',
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(JSON.stringify(parsed.args)).toBe(
        '{"prompt":"best voice control apps for macOS"}',
      );
    }
  });
});

describe('citedSourceNumbers', () => {
  test('keeps referenced sources in prose order and deduplicates them', () => {
    expect(citedSourceNumbers('First (S3), then (S1), repeated (S3).')).toEqual(
      [3, 1],
    );
  });

  test('ignores source numbers that are not citation markers', () => {
    expect(citedSourceNumbers('Sources S1 and S2 are available.')).toEqual([]);
  });
});

const exchangeDb = () => {
  const db = new Database(':memory:');
  const migrationsDir = join(import.meta.dir, '../../../../drizzle');
  for (const file of readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
  }
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    insert into users (id, email, password_hash, salt)
    values (1, 'owner@example.com', 'hash', 'salt');
    insert into workspaces (id, owner_user_id, name)
    values (1, 1, 'Workspace');
    insert into chats (id, workspace_id, title)
    values (1, 1, 'Chat');
  `);
  return db;
};

const insertExchange = (
  db: Database,
  id: string,
  requestId: string,
  status = 'accepted',
) =>
  db.run(
    `insert into chat_exchanges
      (id, request_id, chat_id, workspace_id, status, phase, deadline_at, accepted_at)
     values (?, ?, 1, 1, ?, 'accepted', 2000, 1000)`,
    [id, requestId, status],
  );

const d1Env = (sqlite: Database): AppEnv => {
  type BoundStatement = {
    all: () => Promise<{ results: Record<string, unknown>[] }>;
    first: () => Promise<Record<string, unknown> | null>;
    run: () => Promise<unknown>;
    raw: () => Promise<unknown[][]>;
    execute: () => unknown;
  };
  const adapter = {
    prepare: (query: string) => ({
      bind: (...params: unknown[]): BoundStatement => {
        const statement = sqlite.prepare(query);
        const all = statement.all.bind(statement) as (
          ...values: unknown[]
        ) => Record<string, unknown>[];
        const run = statement.run.bind(statement) as (
          ...values: unknown[]
        ) => unknown;
        return {
          all: async () => ({ results: all(...params) }),
          first: async () => all(...params)[0] ?? null,
          run: async () => run(...params),
          raw: async () => all(...params).map((row) => Object.values(row)),
          execute: () => run(...params),
        };
      },
    }),
    batch: async (statements: BoundStatement[]) =>
      sqlite.transaction(() =>
        statements.map((statement) => statement.execute()),
      )(),
  };
  return { DB: adapter } as unknown as AppEnv;
};

describe('chat exchange persistence', () => {
  test('allows only one active exchange per chat', () => {
    const db = exchangeDb();
    insertExchange(db, 'exchange-1', 'request-1');
    expect(() => insertExchange(db, 'exchange-2', 'request-2')).toThrow();
    db.run(
      "update chat_exchanges set status = 'completed' where id = 'exchange-1'",
    );
    expect(() => insertExchange(db, 'exchange-2', 'request-2')).not.toThrow();
  });

  test('maps a request id to one exchange within a workspace', () => {
    const db = exchangeDb();
    insertExchange(db, 'exchange-1', 'request-1', 'completed');
    expect(() =>
      insertExchange(db, 'exchange-2', 'request-1', 'completed'),
    ).toThrow();
  });

  test('stores at most one message per role for an exchange', () => {
    const db = exchangeDb();
    insertExchange(db, 'exchange-1', 'request-1');
    db.run(
      "insert into chat_messages (exchange_id, chat_id, role, content) values ('exchange-1', 1, 'user', 'Question')",
    );
    expect(() =>
      db.run(
        "insert into chat_messages (exchange_id, chat_id, role, content) values ('exchange-1', 1, 'user', 'Duplicate')",
      ),
    ).toThrow();
    expect(() =>
      db.run(
        "insert into chat_messages (exchange_id, chat_id, role, content) values ('exchange-1', 1, 'assistant', 'Answer')",
      ),
    ).not.toThrow();
  });

  test('account deletion can remove exchange-linked chats child first', () => {
    const db = exchangeDb();
    insertExchange(db, 'exchange-1', 'request-1');
    db.run(
      "insert into chat_messages (exchange_id, chat_id, role, content) values ('exchange-1', 1, 'user', 'Question')",
    );
    db.run(
      "insert into setup_usage (user_id, workspace_id, kind) values (1, 1, 'generate')",
    );
    db.run(
      "insert into setup_commits (workspace_id, draft_version, configuration_hash, idempotency_key) values (1, 1, 'hash', 'key')",
    );
    expect(() =>
      db.transaction(() => {
        db.run('delete from chat_messages');
        db.run('delete from chat_exchanges');
        db.run('delete from chats');
        db.run('delete from setup_commits');
        db.run('delete from workspaces');
        db.run('delete from setup_usage');
        db.run('delete from users');
      })(),
    ).not.toThrow();
  });

  test('commits an answer and terminal exchange state atomically', async () => {
    const sqlite = exchangeDb();
    insertExchange(sqlite, 'exchange-1', 'request-1');
    sqlite.run(
      "insert into chat_messages (exchange_id, chat_id, role, content) values ('exchange-1', 1, 'user', 'Question')",
    );
    sqlite.run(
      "update chat_exchanges set status = 'running', phase = 'finalizing' where id = 'exchange-1'",
    );
    const db = drizzle(sqlite) as unknown as Db;
    const messages = await commitExchangeAnswer(d1Env(sqlite), db, {
      exchangeId: 'exchange-1',
      chatId: 1,
      lastEventSeq: 4,
      exchange: {
        status: 'completed',
        content: 'Answer',
        title: 'Finished chat',
        panels: [],
        panelData: null,
        links: [],
        steps: [],
        durationMs: 50,
        proposal: null,
        sources: [],
        scope: {
          version: 1,
          timezone: 'UTC',
          granularity: 'run_date',
          asOf: '2026-09-16',
          from: '2026-08-18',
          to: '2026-09-16',
          label: 'last 30 days',
          source: 'default',
        },
        evidence: [],
        selectedEvidenceIds: [],
      },
    });
    expect(messages?.map((message) => message.role)).toEqual([
      'user',
      'assistant',
    ]);
    expect(
      sqlite
        .query(
          'select status, phase, last_event_seq as seq from chat_exchanges where id = ?',
        )
        .get('exchange-1'),
    ).toEqual({ status: 'completed', phase: 'terminal', seq: 4 });
    expect(sqlite.query('select title from chats where id = 1').get()).toEqual({
      title: 'Finished chat',
    });
  });

  test('a failure cannot overwrite an exchange that already completed', async () => {
    const sqlite = exchangeDb();
    insertExchange(sqlite, 'exchange-1', 'request-1', 'completed');
    sqlite.run(
      "update chat_exchanges set phase = 'terminal' where id = 'exchange-1'",
    );
    sqlite.run(
      "insert into chat_messages (exchange_id, chat_id, role, content) values ('exchange-1', 1, 'assistant', 'Answer')",
    );
    const committed = await commitExchangeFailure(
      d1Env(sqlite),
      drizzle(sqlite) as unknown as Db,
      {
        exchangeId: 'exchange-1',
        chatId: 1,
        message: 'Failed',
        steps: [],
        durationMs: 100,
        status: 'failed',
        lastEventSeq: 5,
        fromStatuses: ['running'],
      },
    );
    expect(committed).toBe(false);
    expect(
      sqlite
        .query("select status from chat_exchanges where id = 'exchange-1'")
        .get(),
    ).toEqual({ status: 'completed' });
    expect(
      sqlite
        .query(
          "select content from chat_messages where exchange_id = 'exchange-1' and role = 'assistant'",
        )
        .get(),
    ).toEqual({ content: 'Answer' });
  });

  test('does not accept an exchange after workspace deletion starts', async () => {
    const sqlite = exchangeDb();
    sqlite.run('update workspaces set deleting_at = 1000 where id = 1');
    const db = drizzle(sqlite) as unknown as Db;
    await expect(
      acceptExchange(d1Env(sqlite), db, {
        workspaceId: 1,
        chatId: 1,
        requestId: '00000000-0000-4000-8000-000000000001',
        question: 'Question',
        receivedAt: 1001,
      }),
    ).rejects.toBeDefined();
    expect(
      sqlite.query('select count(*) as count from chat_exchanges').get(),
    ).toEqual({ count: 0 });
    expect(
      sqlite.query('select count(*) as count from chat_messages').get(),
    ).toEqual({ count: 0 });
  });

  test('concurrent deletion claims cannot remove both remaining workspaces', async () => {
    const sqlite = exchangeDb();
    sqlite.run(
      "insert into workspaces (id, owner_user_id, name) values (2, 1, 'Second')",
    );
    const db = drizzle(sqlite) as unknown as Db;
    expect(await claimWorkspaceDeletion(db, 1, 1)).toBe(true);
    expect(await claimWorkspaceDeletion(db, 1, 2)).toBe(false);
    expect(
      sqlite
        .query(
          'select id from workspaces where deleting_at is null order by id',
        )
        .all(),
    ).toEqual([{ id: 2 }]);
  });

  test('workspace provisioning is atomically blocked by account deletion', async () => {
    const sqlite = exchangeDb();
    const env = d1Env(sqlite);
    expect(
      await provisionWorkspace(
        env,
        { id: 1, email: 'owner@example.com' },
        'Second',
        null,
      ),
    ).toMatchObject({ ok: true, name: 'Second' });
    sqlite.run('update users set deleting_at = 1000 where id = 1');
    expect(
      await provisionWorkspace(
        env,
        { id: 1, email: 'owner@example.com' },
        'Third',
        null,
      ),
    ).toMatchObject({ ok: false });
    expect(
      sqlite.query('select count(*) as count from workspaces').get(),
    ).toEqual({ count: 2 });
  });
});
