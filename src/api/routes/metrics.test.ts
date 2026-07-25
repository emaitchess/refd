import { describe, expect, test } from 'bun:test';
import {
  answerCount,
  avgPosition,
  cellRate,
  coverageStats,
  firstMentionShare,
  pooledSov,
  prominenceDist,
  runSeries,
  type ScoreRow,
  sentimentDist,
  shareOf,
} from './metrics';

// Row factory: one entity-score atom. Defaults describe a quiet answer.
const row = (over: Partial<ScoreRow>): ScoreRow => ({
  runId: 1,
  date: '2026-07-18',
  entitySetHash: 'h1',
  promptId: 1,
  surface: 'chatgpt',
  sample: 1,
  entityId: 1,
  mentioned: false,
  cited: false,
  position: null,
  prominence: null,
  sentiment: null,
  ...over,
});

describe('cellRate', () => {
  test('null with no rows for the entity', () => {
    expect(cellRate([row({ entityId: 2 })], 1, 'mentioned')).toBeNull();
  });

  test('per-cell sample average, then equal-weight mean over cells', () => {
    const rows = [
      // Cell A (prompt 1): 1 of 2 samples mentioned = 0.5
      row({ promptId: 1, sample: 1, mentioned: true, position: 1 }),
      row({ promptId: 1, sample: 2 }),
      // Cell B (prompt 2): 0 of 1 = 0
      row({ promptId: 2 }),
    ];
    expect(cellRate(rows, 1, 'mentioned')).toBeCloseTo((0.5 + 0) / 2);
  });

  test('cells split by surface and by run, never blended', () => {
    const rows = [
      row({ surface: 'chatgpt', mentioned: true, position: 1 }),
      row({ surface: 'gemini' }),
      row({ runId: 2, mentioned: true, position: 1 }),
    ];
    // Three cells: 1, 0, 1
    expect(cellRate(rows, 1, 'mentioned')).toBeCloseTo(2 / 3);
  });
});

describe('pooledSov', () => {
  test('null when nothing is mentioned (pool empty)', () => {
    expect(pooledSov([row({})], 'mentioned')).toBeNull();
  });

  test('sums to 1 across entities; absent entity is honest 0', () => {
    const rows = [
      row({ entityId: 1, mentioned: true, position: 1 }),
      row({ entityId: 2, mentioned: true, position: 2 }),
      row({ entityId: 2, promptId: 2, mentioned: true, position: 1 }),
      row({ entityId: 3, promptId: 2 }),
    ];
    const sov = pooledSov(rows, 'mentioned');
    expect(shareOf(sov, 1)).toBeCloseTo(1 / 3);
    expect(shareOf(sov, 2)).toBeCloseTo(2 / 3);
    expect(shareOf(sov, 3)).toBe(0);
    expect(shareOf(null, 3)).toBeNull();
  });
});

describe('avgPosition', () => {
  test('conditional on mention: nulls never counted', () => {
    const rows = [
      row({ mentioned: true, position: 1 }),
      row({ promptId: 2, mentioned: true, position: 3 }),
      row({ promptId: 3 }),
    ];
    expect(avgPosition(rows, 1)).toBeCloseTo(2);
    expect(avgPosition(rows, 2)).toBeNull();
  });
});

describe('firstMentionShare', () => {
  test('rank-1 events over answers with any tracked mention', () => {
    const rows = [
      // Answer 1: entity 1 first, entity 2 second.
      row({ entityId: 1, mentioned: true, position: 1 }),
      row({ entityId: 2, mentioned: true, position: 2 }),
      // Answer 2: only entity 2, first.
      row({ promptId: 2, entityId: 2, mentioned: true, position: 1 }),
      // Answer 3: nobody mentioned — outside the pool.
      row({ promptId: 3, entityId: 1 }),
    ];
    const share = firstMentionShare(rows);
    expect(shareOf(share, 1)).toBeCloseTo(1 / 2);
    expect(shareOf(share, 2)).toBeCloseTo(1 / 2);
    expect(firstMentionShare([row({})])).toBeNull();
  });
});

describe('prominenceDist', () => {
  test('counts over mentions; null when never mentioned', () => {
    const rows = [
      row({ mentioned: true, position: 1, prominence: 'lead' }),
      row({ promptId: 2, mentioned: true, position: 1, prominence: 'list' }),
      row({ promptId: 3, mentioned: true, position: 1, prominence: 'list' }),
    ];
    expect(prominenceDist(rows, 1)).toEqual({ lead: 1, body: 0, list: 2 });
    expect(prominenceDist(rows, 9)).toBeNull();
  });
});

describe('sentimentDist', () => {
  test('counts classified mentions only; unclassified excluded, null when none', () => {
    const rows = [
      row({ mentioned: true, sentiment: 'positive' }),
      row({ mentioned: true, sentiment: 'positive', sample: 2 }),
      row({ mentioned: true, sentiment: 'negative', surface: 'gemini' }),
      // Pending or pre-sentiment history: mentioned but unclassified.
      row({ mentioned: true, sentiment: null, surface: 'perplexity' }),
      // A stray label on an unmentioned row must not count.
      row({ mentioned: false, sentiment: 'neutral', surface: 'google_aio' }),
      row({ entityId: 2, mentioned: true, sentiment: null }),
    ];
    expect(sentimentDist(rows, 1)).toEqual({
      positive: 2,
      neutral: 0,
      negative: 1,
    });
    expect(sentimentDist(rows, 2)).toBeNull();
    expect(sentimentDist(rows, 9)).toBeNull();
  });
});

describe('coverageStats', () => {
  test('AIO coverage counts absent answers; source coverage only present ones', () => {
    const rows = [
      { surface: 'google_aio', answerPresent: true, hasSources: true },
      { surface: 'google_aio', answerPresent: false, hasSources: false },
      { surface: 'chatgpt', answerPresent: true, hasSources: false },
    ];
    const stats = coverageStats(rows);
    expect(stats.aio).toEqual({ present: 1, total: 2 });
    expect(stats.sources).toContainEqual({
      surface: 'chatgpt',
      withSources: 0,
      total: 1,
    });
    expect(stats.sources).toContainEqual({
      surface: 'google_aio',
      withSources: 1,
      total: 1,
    });
    expect(coverageStats([]).aio).toBeNull();
  });
});

describe('runSeries', () => {
  test('one point per run, sorted by date, carrying the entity-set hash', () => {
    const rows = [
      row({
        runId: 2,
        date: '2026-07-18',
        entitySetHash: 'h2',
        mentioned: true,
        position: 1,
      }),
      row({ runId: 1, date: '2026-07-17', entitySetHash: 'h1' }),
    ];
    const series = runSeries(rows, [1]);
    expect(series.map((p) => p.runId)).toEqual([1, 2]);
    expect(series[0]?.entitySetHash).toBe('h1');
    expect(series[0]?.entities[1]?.mentionRate).toBe(0);
    expect(series[0]?.entities[1]?.sov).toBeNull();
    expect(series[1]?.entities[1]?.mentionRate).toBe(1);
    expect(series[1]?.entities[1]?.sov).toBe(1);
  });
});

describe('answerCount', () => {
  test('distinct answers across entities', () => {
    const rows = [
      row({ entityId: 1 }),
      row({ entityId: 2 }),
      row({ entityId: 1, sample: 2 }),
    ];
    expect(answerCount(rows)).toBe(2);
  });
});
