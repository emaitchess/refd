import { z } from 'zod';

// How often a workspace's scheduled runs fire. Stored as JSON on the workspace
// row; null falls back to DEFAULT_RUN_SCHEDULE (daily 06:00 UTC), which is
// exactly the pre-schedule behavior.

export const SCHEDULE_KINDS = ['daily', 'weekly'] as const;
export type ScheduleKind = (typeof SCHEDULE_KINDS)[number];

export const SCHEDULE_WEEKDAYS = [
  'Sun',
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
] as const;

export interface RunSchedule {
  enabled: boolean;
  kind: ScheduleKind;
  // Weekly only: the selected days fire every Nth week. Daily ignores it.
  interval: number;
  // Weekly only: selected weekdays, 0=Sunday..6=Saturday, unique and sorted.
  days: number[];
  hourUtc: number;
  minuteUtc: number;
}

export const WEEKLY_INTERVAL_MAX = 8;
export const MINUTE_STEP = 15;

export const DEFAULT_RUN_SCHEDULE: RunSchedule = {
  enabled: true,
  kind: 'daily',
  interval: 1,
  days: [],
  hourUtc: 6,
  minuteUtc: 0,
};

export const runScheduleSchema = z
  .object({
    enabled: z.boolean(),
    kind: z.enum(SCHEDULE_KINDS),
    interval: z.number().int().min(1).max(WEEKLY_INTERVAL_MAX).default(1),
    days: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    hourUtc: z.number().int().min(0).max(23),
    minuteUtc: z
      .number()
      .int()
      .min(0)
      .max(60 - MINUTE_STEP)
      .refine((minute) => minute % MINUTE_STEP === 0, {
        message: `minute must be a ${MINUTE_STEP}-minute step`,
      }),
  })
  .refine(
    (schedule) => schedule.kind !== 'weekly' || schedule.days.length > 0,
    {
      message: 'pick at least one day',
      path: ['days'],
    },
  )
  .transform(
    (schedule): RunSchedule =>
      schedule.kind === 'daily'
        ? { ...schedule, interval: 1, days: [] }
        : {
            ...schedule,
            days: [...new Set(schedule.days)].sort((a, b) => a - b),
          },
  );

export type RunScheduleInput = z.input<typeof runScheduleSchema>;

// Stored JSON is written through runScheduleSchema, but a corrupted row must
// degrade to null (the caller falls back to the default) instead of breaking
// the cron scan.
export const parseRunSchedule = (raw: unknown): RunSchedule | null => {
  const parsed = runScheduleSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};

const DAY_MS = 86_400_000;

// Fixed Monday anchor: "every N weeks" counts from it, so occurrences are
// deterministic forever and never depend on when the schedule was saved or
// which process evaluates it. 2026-01-05 is a Monday.
const ANCHOR_MS = Date.UTC(2026, 0, 5);

const utcMidnightMs = (date: string): number => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    return Number.NaN;
  }
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
};

export const isoDateUtc = (ms: number): string =>
  new Date(ms).toISOString().slice(0, 10);

export const weekdayOf = (date: string): number => {
  const midnight = utcMidnightMs(date);
  return Number.isNaN(midnight) ? -1 : new Date(midnight).getUTCDay();
};

const weekIndexOf = (date: string): number =>
  Math.floor((utcMidnightMs(date) - ANCHOR_MS) / (7 * DAY_MS));

export const isOccurrenceDay = (
  schedule: RunSchedule,
  date: string,
): boolean => {
  if (schedule.kind === 'daily') {
    return true;
  }
  if (!schedule.days.includes(weekdayOf(date))) {
    return false;
  }
  const index = weekIndexOf(date);
  const interval = Math.max(1, schedule.interval);
  return ((index % interval) + interval) % interval === 0;
};

export const scheduledTimeMs = (schedule: RunSchedule, date: string): number =>
  utcMidnightMs(date) +
  schedule.hourUtc * 3_600_000 +
  schedule.minuteUtc * 60_000;

// The UTC date whose scheduled run should exist at `now`, or null: today when
// today is an occurrence day whose time has arrived. Earlier missed days do
// not catch up, and the per-date run key caps a schedule at one run per day.
export const dueScheduledRunDate = (
  schedule: RunSchedule,
  now: number,
): string | null => {
  if (!schedule.enabled) {
    return null;
  }
  const today = isoDateUtc(now);
  if (!isOccurrenceDay(schedule, today)) {
    return null;
  }
  return now >= scheduledTimeMs(schedule, today) ? today : null;
};

// The first `count` occurrence dates strictly after `from`. Bounded scan: the
// widest gap a valid schedule can have is WEEKLY_INTERVAL_MAX weeks.
export const nextOccurrenceDates = (
  schedule: RunSchedule,
  from: number,
  count: number,
): string[] => {
  const dates: string[] = [];
  let midnight = Math.floor(from / DAY_MS) * DAY_MS;
  for (let step = 0; step < 400 && dates.length < count; step += 1) {
    const date = isoDateUtc(midnight);
    if (
      isOccurrenceDay(schedule, date) &&
      scheduledTimeMs(schedule, date) > from
    ) {
      dates.push(date);
    }
    midnight += DAY_MS;
  }
  return dates;
};
