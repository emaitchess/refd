import { describe, expect, test } from 'bun:test';
import type { ChatScope } from '@refd/core/chat';
import {
  addUtcDays,
  legacyRangeScope,
  rangeLabel,
  rangeWindows,
  resolveChatScope,
} from './range';

// 2026-09-16 is a Wednesday; every expectation below is pinned to it.
const SEP16 = Date.UTC(2026, 8, 16, 14, 30);
const SEP17 = Date.UTC(2026, 8, 17, 14, 30);
const JAN5 = Date.UTC(2026, 0, 5, 9);
const MAR31_2024 = Date.UTC(2024, 2, 31, 9);

const inherited: ChatScope = {
  version: 1,
  timezone: 'UTC',
  granularity: 'run_date',
  asOf: '2026-09-10',
  from: '2026-08-01',
  to: '2026-08-31',
  label: 'last month (2026-08-01 to 2026-08-31)',
  source: 'explicit',
};

describe('resolveChatScope', () => {
  test('no date hint and nothing to inherit is an exact trailing 30 dates', () => {
    const scope = resolveChatScope('how is my brand performing?', SEP16);
    expect(scope).toEqual({
      version: 1,
      timezone: 'UTC',
      granularity: 'run_date',
      asOf: '2026-09-16',
      from: '2026-08-18',
      to: '2026-09-16',
      label: 'last 30 days (2026-08-18 to 2026-09-16)',
      source: 'default',
    });
  });

  test('counted windows are exact, never snapped to a preset', () => {
    expect(resolveChatScope('citations over the past 14 days', SEP16)).toEqual(
      expect.objectContaining({
        from: '2026-09-03',
        to: '2026-09-16',
        source: 'explicit',
      }),
    );
    expect(resolveChatScope('past 2 weeks of mentions', SEP16)).toEqual(
      expect.objectContaining({ from: '2026-09-03', to: '2026-09-16' }),
    );
    expect(resolveChatScope('previous 3 months', SEP16)).toEqual(
      expect.objectContaining({ from: '2026-06-19', to: '2026-09-16' }),
    );
    expect(resolveChatScope('last 1 day', SEP16)).toEqual(
      expect.objectContaining({ from: '2026-09-16', to: '2026-09-16' }),
    );
  });

  test('today and yesterday are single run dates', () => {
    expect(resolveChatScope('anything today?', SEP16)).toEqual(
      expect.objectContaining({ from: '2026-09-16', to: '2026-09-16' }),
    );
    expect(resolveChatScope('what about yesterday', SEP16)).toEqual(
      expect.objectContaining({ from: '2026-09-15', to: '2026-09-15' }),
    );
  });

  test('relative day offsets resolve instead of inheriting the prior scope', () => {
    // The production follow-up that inherited "yesterday (2026-09-16)"
    // because nothing detected the phrase: the answer must be scoped to the
    // asked-about day, never the inherited one.
    const inherited = resolveChatScope('what about yesterday', SEP17);
    expect(
      resolveChatScope(
        'what about the day before yesterday?',
        SEP17,
        inherited,
      ),
    ).toEqual(
      expect.objectContaining({
        from: '2026-09-15',
        to: '2026-09-15',
        source: 'explicit',
        label: 'day before yesterday (2026-09-15)',
      }),
    );
    expect(resolveChatScope('and two days ago', SEP16)).toEqual(
      expect.objectContaining({
        from: '2026-09-14',
        to: '2026-09-14',
        label: '2 days ago (2026-09-14)',
      }),
    );
    expect(resolveChatScope('the citation rate 3 days ago', SEP16)).toEqual(
      expect.objectContaining({ from: '2026-09-13', to: '2026-09-13' }),
    );
  });

  test('weeks anchor to UTC Monday', () => {
    expect(resolveChatScope('how was this week?', SEP16)).toEqual(
      expect.objectContaining({ from: '2026-09-14', to: '2026-09-16' }),
    );
    expect(resolveChatScope('what about last week', SEP16)).toEqual(
      expect.objectContaining({ from: '2026-09-07', to: '2026-09-13' }),
    );
    expect(resolveChatScope('the past week overall', SEP16)).toEqual(
      expect.objectContaining({ from: '2026-09-10', to: '2026-09-16' }),
    );
  });

  test('calendar months, including year and leap boundaries', () => {
    expect(resolveChatScope('summarize this month', SEP16)).toEqual(
      expect.objectContaining({ from: '2026-09-01', to: '2026-09-16' }),
    );
    expect(resolveChatScope('what about last month', SEP16)).toEqual(
      expect.objectContaining({ from: '2026-08-01', to: '2026-08-31' }),
    );
    expect(resolveChatScope('what about last month', JAN5)).toEqual(
      expect.objectContaining({ from: '2025-12-01', to: '2025-12-31' }),
    );
    expect(resolveChatScope('what about last month', MAR31_2024)).toEqual(
      expect.objectContaining({ from: '2024-02-01', to: '2024-02-29' }),
    );
  });

  test('all-history and explicit ranges', () => {
    expect(resolveChatScope('has the brand ever been cited?', SEP16)).toEqual(
      expect.objectContaining({ from: null, to: '2026-09-16' }),
    );
    expect(
      resolveChatScope('from 2026-08-01 to 2026-08-31 how did we do', SEP16),
    ).toEqual(
      expect.objectContaining({
        from: '2026-08-01',
        to: '2026-08-31',
        source: 'explicit',
      }),
    );
  });

  test('a standalone absolute date is that one run date', () => {
    // The production question that used to fall through to 30 days.
    for (const phrasing of [
      'For the completed run on 16th September only, give me our mention rate.',
      'mention rate on 16 September',
      'What happened September 16?',
      'How did we do on Sep 16?',
      'the run dated 2026-09-16',
    ]) {
      expect(resolveChatScope(phrasing, SEP16)).toEqual(
        expect.objectContaining({
          from: '2026-09-16',
          to: '2026-09-16',
          source: 'explicit',
        }),
      );
    }
    // The scope label reads to a human, so the month keeps its capital.
    expect(resolveChatScope('the run on 16 September', SEP16).label).toBe(
      '16 September (2026-09-16)',
    );
    expect(resolveChatScope('the run on 16 September 2026', SEP16).label).toBe(
      '16 September 2026 (2026-09-16)',
    );
  });

  test('absolute dates without a year bind to the most recent occurrence', () => {
    // Asked in October, "16 September" means this year's, never next year's.
    expect(
      resolveChatScope('the run on 16 September', Date.UTC(2026, 9, 2, 9)),
    ).toEqual(
      expect.objectContaining({ from: '2026-09-16', to: '2026-09-16' }),
    );
    // Asked before that date in the same year, it means the year before.
    expect(
      resolveChatScope('the run on 16 September', Date.UTC(2026, 1, 2, 9)),
    ).toEqual(
      expect.objectContaining({ from: '2025-09-16', to: '2025-09-16' }),
    );
  });

  test('absolute dates reject impossible calendar days and future dates', () => {
    expect(resolveChatScope('results on 31 February 2026', SEP16)).toEqual(
      expect.objectContaining({ source: 'default' }),
    );
    expect(
      resolveChatScope('what will happen on 16 December 2026', SEP16),
    ).toEqual(expect.objectContaining({ source: 'default' }));
  });

  test('a follow-up without new date words inherits the frozen bounds', () => {
    const scope = resolveChatScope(
      'what about citations?',
      SEP16,
      inherited,
      42,
    );
    expect(scope).toEqual(
      expect.objectContaining({
        from: '2026-08-01',
        to: '2026-08-31',
        asOf: '2026-09-16',
        source: 'inherited',
        inheritedFromMessageId: 42,
      }),
    );
    // dataThrough from the inherited answer is not carried over as fact.
    expect('dataThrough' in scope).toBe(false);
  });

  test('an explicit window overrides inheritance', () => {
    const scope = resolveChatScope('no, use last month instead', SEP16, {
      ...inherited,
      from: '2026-09-01',
      to: '2026-09-16',
    });
    expect(scope).toEqual(
      expect.objectContaining({
        from: '2026-08-01',
        to: '2026-08-31',
        source: 'explicit',
      }),
    );
    expect('inheritedFromMessageId' in scope).toBe(false);
  });

  test('addUtcDays crosses month and year boundaries in UTC', () => {
    expect(addUtcDays('2026-09-16', -13)).toBe('2026-09-03');
    expect(addUtcDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addUtcDays('2026-01-01', -1)).toBe('2025-12-31');
  });
});

describe('rangeLabel', () => {
  test('labels', () => {
    expect(rangeLabel('7d')).toBe('last 7 days');
    expect(rangeLabel('all')).toBe('all history');
  });
});

describe('legacyRangeScope', () => {
  test('Range presets keep the windows the dashboard has always computed', () => {
    expect(legacyRangeScope('30d', SEP16)).toEqual({
      version: 1,
      timezone: 'UTC',
      granularity: 'run_date',
      asOf: '2026-09-16',
      // N days back through today: the same bounds as ?range consumers.
      from: '2026-08-17',
      to: '2026-09-16',
      label: 'last 30 days',
      source: 'default',
    });
    // '1d' stays [yesterday..today], never the chat path's today-only window.
    expect(legacyRangeScope('1d', SEP16)).toEqual(
      expect.objectContaining({ from: '2026-09-15', to: '2026-09-16' }),
    );
    expect(legacyRangeScope('all', SEP16)).toEqual(
      expect.objectContaining({ from: null, label: 'all history' }),
    );
  });

  test('bounds agree with rangeWindows for every preset', () => {
    for (const range of ['1d', '3d', '7d', '30d', '90d'] as const) {
      expect(legacyRangeScope(range).from).toBe(rangeWindows(range).from);
    }
  });
});
