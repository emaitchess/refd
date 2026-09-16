import { describe, expect, test } from 'bun:test';
import {
  chatEvidenceRecordSchema,
  chatScopeSchema,
  chatStartResponseSchema,
  chatStreamEventSchema,
  isActiveChatExchange,
} from './chat';

const exchangeId = '49d84285-4fb7-4b76-bcbe-924c959f84bb';
const requestId = '67a951d1-14b2-44c9-8f73-713a83952bd2';

describe('chat exchange contracts', () => {
  test('accepts a complete start receipt', () => {
    expect(
      chatStartResponseSchema.safeParse({
        chatId: 2,
        title: 'Citation trend',
        exchange: {
          id: exchangeId,
          requestId,
          status: 'accepted',
          phase: 'accepted',
          questionId: 7,
          deadlineAt: 1_800_000_000_000,
          lastEventSeq: 0,
          error: null,
        },
        question: {
          id: 7,
          role: 'user',
          content: 'What changed?',
          createdAt: 1_799_999_700_000,
        },
      }).success,
    ).toBe(true);
  });

  test('rejects receipts without durable exchange identity', () => {
    expect(
      chatStartResponseSchema.safeParse({
        chatId: 2,
        question: { id: 7, content: 'What changed?' },
      }).success,
    ).toBe(false);
  });

  test('requires sequence and exchange identity on stream events', () => {
    expect(
      chatStreamEventSchema.safeParse({
        type: 'delta',
        exchangeId,
        seq: 3,
        text: 'Evidence',
      }).success,
    ).toBe(true);
    expect(
      chatStreamEventSchema.safeParse({
        type: 'meta',
        exchangeId,
        seq: 3,
        panels: ['overview'],
        panelData: { overview: { mentionRate: 0.5 } },
      }).success,
    ).toBe(true);
    expect(
      chatStreamEventSchema.safeParse({ type: 'delta', text: 'Evidence' })
        .success,
    ).toBe(false);
  });

  test('only accepted and running exchanges are active', () => {
    expect(isActiveChatExchange('accepted')).toBe(true);
    expect(isActiveChatExchange('running')).toBe(true);
    expect(isActiveChatExchange('completed')).toBe(false);
    expect(isActiveChatExchange('partial')).toBe(false);
    expect(isActiveChatExchange('failed')).toBe(false);
    expect(isActiveChatExchange('cancelled')).toBe(false);
  });
});

describe('chat scope contract', () => {
  const scope = {
    version: 1,
    timezone: 'UTC',
    granularity: 'run_date',
    asOf: '2026-09-16',
    from: '2026-08-18',
    to: '2026-09-16',
    label: 'last 30 days',
    source: 'default',
  };

  test('accepts a complete scope, with all-history as a null lower bound', () => {
    expect(chatScopeSchema.safeParse(scope).success).toBe(true);
    expect(
      chatScopeSchema.safeParse({
        ...scope,
        from: null,
        source: 'inherited',
        inheritedFromMessageId: 9,
        dataThrough: '2026-09-15',
      }).success,
    ).toBe(true);
  });

  test('rejects off-format dates, foreign timezones, and unknown sources', () => {
    expect(
      chatScopeSchema.safeParse({ ...scope, asOf: '2026-9-16' }).success,
    ).toBe(false);
    expect(
      chatScopeSchema.safeParse({ ...scope, timezone: 'PST' }).success,
    ).toBe(false);
    expect(
      chatScopeSchema.safeParse({ ...scope, source: 'guessed' }).success,
    ).toBe(false);
    // `to` is always a real date: all-history is expressed as from: null.
    expect(chatScopeSchema.safeParse({ ...scope, to: null }).success).toBe(
      false,
    );
  });
});

describe('chat evidence contract', () => {
  const record = {
    id: 'E1',
    status: 'ok',
    origin: 'tool',
    tool: 'query_results',
    arguments: { limit: 5 },
    result: '5 answers',
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
    provenance: [
      {
        kind: 'result',
        resultId: 7,
        runId: 3,
        promptId: 2,
        surface: 'chatgpt',
        runDate: '2026-09-15',
      },
    ],
  };

  test('accepts a tool record with result provenance', () => {
    expect(chatEvidenceRecordSchema.safeParse(record).success).toBe(true);
  });

  test('accepts web and derived provenance kinds', () => {
    expect(
      chatEvidenceRecordSchema.safeParse({
        ...record,
        provenance: [
          {
            kind: 'web',
            url: 'https://example.com',
            title: 'Example',
            retrieval: 'page',
            retrievedAt: 1_800_000_000_000,
          },
          { kind: 'derived', derivation: 'aggregate', metric: 'mentionRate' },
        ],
      }).success,
    ).toBe(true);
  });

  test('rejects malformed ids, statuses, provenance shapes, and scope drift', () => {
    expect(
      chatEvidenceRecordSchema.safeParse({ ...record, id: 'X1' }).success,
    ).toBe(false);
    expect(
      chatEvidenceRecordSchema.safeParse({ ...record, status: 'fine' }).success,
    ).toBe(false);
    expect(
      chatEvidenceRecordSchema.safeParse({
        ...record,
        provenance: [{ kind: 'result', resultId: 7 }],
      }).success,
    ).toBe(false);
    expect(
      chatEvidenceRecordSchema.safeParse({
        ...record,
        scope: { ...record.scope, asOf: 'today' },
      }).success,
    ).toBe(false);
  });
});
