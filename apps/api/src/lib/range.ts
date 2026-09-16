import type { ChatScope } from '@refd/core/chat';
import { z } from 'zod';

export const rangeSchema = z
  .enum(['1d', '3d', '7d', '30d', '90d', 'all'])
  .default('30d');
export type Range = z.infer<typeof rangeSchema>;

const RANGE_DAYS: Record<Exclude<Range, 'all'>, number> = {
  '1d': 1,
  '3d': 3,
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

const isoDaysAgo = (days: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
};

const utcDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export const addUtcDays = (date: string, days: number): string => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

const startOfUtcWeek = (date: string): string => {
  const value = new Date(`${date}T00:00:00.000Z`);
  const mondayOffset = (value.getUTCDay() + 6) % 7;
  return addUtcDays(date, -mondayOffset);
};

const monthBounds = (
  date: string,
  offset: number,
): { from: string; to: string } => {
  const value = new Date(`${date}T00:00:00.000Z`);
  const from = new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + offset, 1),
  );
  const next = new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + offset + 1, 1),
  );
  next.setUTCDate(next.getUTCDate() - 1);
  return {
    from: from.toISOString().slice(0, 10),
    to: next.toISOString().slice(0, 10),
  };
};

interface DetectedScope {
  from: string | null;
  to: string;
  label: string;
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
const MONTH_ALIASES = new Map<string, number>(
  MONTHS.flatMap((name, index) => [
    [name, index],
    [name.slice(0, 3), index],
  ]),
);
const DAY_IN_MONTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const isLeapYear = (year: number): boolean =>
  year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

const isoFor = (year: number, month: number, day: number): string | null => {
  if (month < 0 || month > 11 || day < 1) {
    return null;
  }
  const maxDay =
    month === 1 && isLeapYear(year) ? 29 : (DAY_IN_MONTHS[month] ?? 0);
  if (day > maxDay) {
    return null;
  }
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
};

// A standalone absolute date ("16th September", "September 16", "2026-09-16")
// resolves to that one run date. Without a year the date binds to the most
// recent occurrence at or before the question, so a September question asked
// in October still lands on this year's September, never next year's.
const detectSingleDate = (text: string, asOf: string): DetectedScope | null => {
  const q = text.toLocaleLowerCase();
  const asOfYear = Number.parseInt(
    asOf.split('-')[0] ?? String(new Date(asOf).getUTCFullYear()),
    10,
  );

  const dayMonth =
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]+)\s*,?\s*(\d{4})?\b/.exec(
      q,
    );
  const monthDay =
    /\b([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*(\d{4})?\b/.exec(q);
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(q);

  let year: number | null = null;
  let month: number | null = null;
  let day: number | null = null;
  let yearExplicit = false;

  if (dayMonth?.[1] && dayMonth[2]) {
    day = Number.parseInt(dayMonth[1], 10);
    month = MONTH_ALIASES.get(dayMonth[2]) ?? null;
    if (dayMonth[3]) {
      year = Number.parseInt(dayMonth[3], 10);
      yearExplicit = true;
    }
  } else if (monthDay?.[1] && monthDay[2]) {
    month = MONTH_ALIASES.get(monthDay[1]) ?? null;
    day = Number.parseInt(monthDay[2], 10);
    if (monthDay[3]) {
      year = Number.parseInt(monthDay[3], 10);
      yearExplicit = true;
    }
  } else if (iso?.[1] && iso[2] && iso[3]) {
    year = Number.parseInt(iso[1], 10);
    month = Number.parseInt(iso[2], 10) - 1;
    day = Number.parseInt(iso[3], 10);
    yearExplicit = true;
  }
  if (month === null || day === null) {
    return null;
  }
  if (year === null) {
    year = asOfYear;
    const candidate = isoFor(year, month, day);
    if (candidate && candidate > asOf) {
      year -= 1;
    }
  }
  const from = isoFor(year, month, day);
  if (!from || from > asOf) {
    return null;
  }
  const monthLabel = MONTHS[month] ?? '';
  const spoken = `${day} ${monthLabel.charAt(0).toUpperCase()}${monthLabel.slice(1)}${yearExplicit ? ` ${year}` : ''}`;
  return { from, to: from, label: `${spoken} (${from})` };
};

const detectScope = (text: string, asOf: string): DetectedScope | null => {
  const q = text.toLocaleLowerCase();
  const exact =
    /\b(?:from|between)\s+(\d{4}-\d{2}-\d{2})\s+(?:to|and)\s+(\d{4}-\d{2}-\d{2})\b/.exec(
      q,
    );
  if (exact?.[1] && exact[2] && exact[1] <= exact[2]) {
    return {
      from: exact[1],
      to: exact[2],
      label: `${exact[1]} to ${exact[2]}`,
    };
  }
  const single = detectSingleDate(text, asOf);
  if (single) {
    return single;
  }
  if (
    /\b(all[ -]?time|ever|entire history|all history|since (the )?(start|beginning|launch))\b/.test(
      q,
    )
  ) {
    return { from: null, to: asOf, label: `all history through ${asOf}` };
  }
  if (/\byesterday\b/.test(q)) {
    const day = addUtcDays(asOf, -1);
    return { from: day, to: day, label: `yesterday (${day})` };
  }
  if (/\btoday\b|\blast 24 hours\b/.test(q)) {
    return { from: asOf, to: asOf, label: `today (${asOf})` };
  }
  if (/\bthis week\b/.test(q)) {
    return {
      from: startOfUtcWeek(asOf),
      to: asOf,
      label: `this week through ${asOf}`,
    };
  }
  if (/\blast week\b/.test(q)) {
    const thisWeek = startOfUtcWeek(asOf);
    const from = addUtcDays(thisWeek, -7);
    const to = addUtcDays(thisWeek, -1);
    return { from, to, label: `last week (${from} to ${to})` };
  }
  if (/\bthis month\b/.test(q)) {
    const { from } = monthBounds(asOf, 0);
    return { from, to: asOf, label: `this month through ${asOf}` };
  }
  if (/\blast month\b/.test(q)) {
    const { from, to } = monthBounds(asOf, -1);
    return { from, to, label: `last month (${from} to ${to})` };
  }
  const counted =
    /\b(?:past|last|previous)\s+(\d+)\s*(day|week|month)s?\b/.exec(q);
  if (counted?.[1] && counted[2]) {
    const count = Number.parseInt(counted[1], 10);
    if (count > 0 && count <= 3650) {
      const days =
        counted[2] === 'day'
          ? count
          : counted[2] === 'week'
            ? count * 7
            : count * 30;
      const from = addUtcDays(asOf, -(days - 1));
      return {
        from,
        to: asOf,
        label: `last ${days} days (${from} to ${asOf})`,
      };
    }
  }
  if (/\b(?:this|past) week\b/.test(q)) {
    const from = addUtcDays(asOf, -6);
    return { from, to: asOf, label: `last 7 days (${from} to ${asOf})` };
  }
  if (/\b(?:past) month\b/.test(q)) {
    const from = addUtcDays(asOf, -29);
    return { from, to: asOf, label: `last 30 days (${from} to ${asOf})` };
  }
  if (/\b(?:this|past|last) quarter\b/.test(q)) {
    const from = addUtcDays(asOf, -89);
    return { from, to: asOf, label: `last 90 days (${from} to ${asOf})` };
  }
  return null;
};

export const resolveChatScope = (
  text: string,
  acceptedAt: number,
  inherited?: ChatScope | null,
  inheritedFromMessageId?: number,
): ChatScope => {
  const asOf = utcDate(acceptedAt);
  const explicit = detectScope(text, asOf);
  if (explicit) {
    return {
      version: 1,
      timezone: 'UTC',
      granularity: 'run_date',
      asOf,
      ...explicit,
      source: 'explicit',
    };
  }
  if (inherited) {
    // dataThrough describes what the previous answer actually saw; the new
    // exchange recomputes it, so it is dropped rather than inherited as fact.
    const { dataThrough: _previousDataThrough, ...rest } = inherited;
    return {
      ...rest,
      asOf,
      source: 'inherited',
      ...(inheritedFromMessageId ? { inheritedFromMessageId } : {}),
    };
  }
  const from = addUtcDays(asOf, -29);
  return {
    version: 1,
    timezone: 'UTC',
    granularity: 'run_date',
    asOf,
    from,
    to: asOf,
    label: `last 30 days (${from} to ${asOf})`,
    source: 'default',
  };
};

// The ?range presets are a dashboard/MCP contract: a Range-keyed digest must
// keep the exact bounds rangeWindows has always produced (N days back through
// today), or its numbers stop matching the pages sharing the same range key.
// Exact calendar windows belong to chat questions, not to these presets.
export const legacyRangeScope = (range: Range, now = Date.now()): ChatScope => {
  const asOf = utcDate(now);
  return {
    version: 1,
    timezone: 'UTC',
    granularity: 'run_date',
    asOf,
    from: range === 'all' ? null : addUtcDays(asOf, -RANGE_DAYS[range]),
    to: asOf,
    label: rangeLabel(range),
    source: 'default',
  };
};

// Current window [from, today] and the previous equivalent window for deltas.
export const rangeWindows = (
  range: Range,
): { from: string; prevFrom: string; prevTo: string } => {
  if (range === 'all') {
    return { from: '0000-00-00', prevFrom: '0000-00-00', prevTo: '0000-00-00' };
  }
  const days = RANGE_DAYS[range];
  return {
    from: isoDaysAgo(days),
    prevFrom: isoDaysAgo(days * 2),
    prevTo: isoDaysAgo(days),
  };
};

// Parse the ?range query param into its validated value plus its date windows.
export const parseRange = (raw: string | undefined) => {
  const range = rangeSchema.parse(raw ?? undefined);
  return { range, ...rangeWindows(range) };
};

export const rangeLabel = (range: Range): string =>
  range === 'all' ? 'all history' : `last ${RANGE_DAYS[range]} days`;
