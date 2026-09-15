import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_RUN_SCHEDULE,
  dueScheduledRunDate,
  isOccurrenceDay,
  isoDateUtc,
  nextOccurrenceDates,
  parseRunSchedule,
  type RunSchedule,
  scheduledTimeMs,
  weekdayOf,
} from './schedule';

const ms = (y: number, m: number, d: number, hour = 0, minute = 0): number =>
  Date.UTC(y, m - 1, d, hour, minute);

const daily = (overrides: Partial<RunSchedule> = {}): RunSchedule => ({
  ...DEFAULT_RUN_SCHEDULE,
  ...overrides,
});

const weekly = (days: number[], interval = 1, hourUtc = 10): RunSchedule => ({
  enabled: true,
  kind: 'weekly',
  interval,
  days,
  hourUtc,
  minuteUtc: 0,
});

// 2026-01-05 is the schedule anchor (a Monday).
const MON_ANCHOR = '2026-01-05';
const MON_NEXT = '2026-01-12';
const MON_AFTER = '2026-01-19';
const TUE_ANCHOR = '2026-01-06';

describe('parseRunSchedule', () => {
  test('accepts a valid daily schedule and canonicalizes it', () => {
    const parsed = parseRunSchedule({
      enabled: true,
      kind: 'daily',
      interval: 5,
      days: [1, 3],
      hourUtc: 6,
      minuteUtc: 0,
    });
    expect(parsed).toEqual({
      enabled: true,
      kind: 'daily',
      interval: 1,
      days: [],
      hourUtc: 6,
      minuteUtc: 0,
    });
  });

  test('accepts a weekly schedule and sorts + dedupes days', () => {
    const parsed = parseRunSchedule({
      enabled: true,
      kind: 'weekly',
      interval: 2,
      days: [5, 1, 1, 3],
      hourUtc: 22,
      minuteUtc: 45,
    });
    expect(parsed).toEqual({
      enabled: true,
      kind: 'weekly',
      interval: 2,
      days: [1, 3, 5],
      hourUtc: 22,
      minuteUtc: 45,
    });
  });

  test('rejects weekly with no days', () => {
    expect(
      parseRunSchedule({
        enabled: true,
        kind: 'weekly',
        interval: 1,
        days: [],
        hourUtc: 10,
        minuteUtc: 0,
      }),
    ).toBeNull();
  });

  test('rejects out-of-range and off-grid values', () => {
    const base = {
      enabled: true,
      kind: 'daily',
      interval: 1,
      days: [],
      hourUtc: 6,
      minuteUtc: 0,
    };
    expect(parseRunSchedule({ ...base, hourUtc: 24 })).toBeNull();
    expect(parseRunSchedule({ ...base, hourUtc: -1 })).toBeNull();
    expect(parseRunSchedule({ ...base, minuteUtc: 10 })).toBeNull();
    expect(parseRunSchedule({ ...base, minuteUtc: 60 })).toBeNull();
    expect(
      parseRunSchedule({ ...base, kind: 'weekly', interval: 9, days: [1] }),
    ).toBeNull();
    expect(parseRunSchedule({ ...base, kind: 'weekly', days: [7] })).toBeNull();
  });

  test('rejects garbage and null', () => {
    expect(parseRunSchedule(null)).toBeNull();
    expect(parseRunSchedule('daily')).toBeNull();
    expect(parseRunSchedule({})).toBeNull();
  });
});

describe('date helpers', () => {
  test('isoDateUtc and weekdayOf agree', () => {
    expect(isoDateUtc(ms(2026, 1, 5))).toBe(MON_ANCHOR);
    expect(weekdayOf(MON_ANCHOR)).toBe(1);
    expect(weekdayOf('2026-01-10')).toBe(6);
    expect(weekdayOf('2026-01-11')).toBe(0);
    expect(weekdayOf('nonsense')).toBe(-1);
  });

  test('scheduledTimeMs composes UTC midnight with the time of day', () => {
    expect(scheduledTimeMs(weekly([1], 1, 10), MON_ANCHOR)).toBe(
      ms(2026, 1, 5, 10, 0),
    );
    expect(
      scheduledTimeMs(daily({ hourUtc: 6, minuteUtc: 30 }), '2026-03-01'),
    ).toBe(ms(2026, 3, 1, 6, 30));
  });
});

describe('isOccurrenceDay', () => {
  test('daily fires every day', () => {
    for (const date of [MON_ANCHOR, TUE_ANCHOR, '2027-06-15']) {
      expect(isOccurrenceDay(daily(), date)).toBe(true);
    }
  });

  test('weekly interval 1 fires on every selected weekday', () => {
    const schedule = weekly([1, 3, 5]);
    expect(isOccurrenceDay(schedule, MON_ANCHOR)).toBe(true);
    expect(isOccurrenceDay(schedule, '2026-01-07')).toBe(true);
    expect(isOccurrenceDay(schedule, '2026-01-09')).toBe(true);
    expect(isOccurrenceDay(schedule, TUE_ANCHOR)).toBe(false);
    expect(isOccurrenceDay(schedule, '2026-01-10')).toBe(false);
  });

  test('weekly interval 2 alternates weeks from the anchor', () => {
    const schedule = weekly([1], 2);
    expect(isOccurrenceDay(schedule, MON_ANCHOR)).toBe(true);
    expect(isOccurrenceDay(schedule, MON_NEXT)).toBe(false);
    expect(isOccurrenceDay(schedule, MON_AFTER)).toBe(true);
    expect(isOccurrenceDay(schedule, '2026-01-26')).toBe(false);
  });

  test('weekly interval stays correct across a year boundary', () => {
    const schedule = weekly([1], 2);
    // Consecutive Mondays spanning 2026→2027: the week index must not drift.
    expect(isOccurrenceDay(schedule, '2026-12-21')).toBe(true);
    expect(isOccurrenceDay(schedule, '2026-12-28')).toBe(false);
    expect(isOccurrenceDay(schedule, '2027-01-04')).toBe(true);
  });

  test('weekly anchors correctly for dates before the anchor', () => {
    const schedule = weekly([1], 2);
    expect(isOccurrenceDay(schedule, '2025-12-22')).toBe(true);
    expect(isOccurrenceDay(schedule, '2025-12-29')).toBe(false);
  });
});

describe('dueScheduledRunDate', () => {
  test('default daily schedule is due from 06:00 UTC onward', () => {
    expect(
      dueScheduledRunDate(DEFAULT_RUN_SCHEDULE, ms(2026, 9, 15, 5, 59)),
    ).toBeNull();
    expect(
      dueScheduledRunDate(DEFAULT_RUN_SCHEDULE, ms(2026, 9, 15, 6, 0)),
    ).toBe('2026-09-15');
    expect(
      dueScheduledRunDate(DEFAULT_RUN_SCHEDULE, ms(2026, 9, 15, 23, 45)),
    ).toBe('2026-09-15');
  });

  test('weekly schedule is due only on occurrence days after the time', () => {
    const schedule = weekly([1], 1, 10);
    expect(dueScheduledRunDate(schedule, ms(2026, 1, 5, 9, 59))).toBeNull();
    expect(dueScheduledRunDate(schedule, ms(2026, 1, 5, 10, 0))).toBe(
      MON_ANCHOR,
    );
    expect(dueScheduledRunDate(schedule, ms(2026, 1, 6, 11, 0))).toBeNull();
    expect(dueScheduledRunDate(schedule, ms(2026, 1, 12, 10, 0))).toBe(
      MON_NEXT,
    );
  });

  test('a disabled schedule is never due', () => {
    expect(
      dueScheduledRunDate(daily({ enabled: false }), ms(2026, 9, 15, 7, 0)),
    ).toBeNull();
  });
});

describe('nextOccurrenceDates', () => {
  test('includes today when the time is still ahead', () => {
    expect(nextOccurrenceDates(weekly([1]), ms(2026, 1, 5, 9, 0), 2)).toEqual([
      MON_ANCHOR,
      MON_NEXT,
    ]);
  });

  test('skips today once the time has passed', () => {
    expect(nextOccurrenceDates(weekly([1]), ms(2026, 1, 5, 10, 1), 2)).toEqual([
      MON_NEXT,
      MON_AFTER,
    ]);
  });

  test('honors the interval when previewing', () => {
    expect(
      nextOccurrenceDates(weekly([1], 2), ms(2026, 1, 5, 9, 0), 3),
    ).toEqual([MON_ANCHOR, MON_AFTER, '2026-02-02']);
  });

  test('daily previews consecutive days', () => {
    expect(
      nextOccurrenceDates(
        daily({ hourUtc: 23, minuteUtc: 45 }),
        ms(2026, 9, 15, 23, 50),
        3,
      ),
    ).toEqual(['2026-09-16', '2026-09-17', '2026-09-18']);
  });

  test('multi-day weekly lists days inside the same week in order', () => {
    expect(
      nextOccurrenceDates(weekly([1, 3, 5]), ms(2026, 1, 5, 12, 0), 3),
    ).toEqual(['2026-01-07', '2026-01-09', '2026-01-12']);
  });
});
