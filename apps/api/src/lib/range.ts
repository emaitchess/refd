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
