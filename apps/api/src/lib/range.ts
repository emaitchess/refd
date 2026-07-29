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

// Chat questions can name their own window ("past 7 days", "all time").
// Detection is deliberately phrase-bounded: no match means the caller's
// default, never a guess.
export const detectRange = (text: string): Range | null => {
  const q = text.toLocaleLowerCase();
  if (
    /\b(all[ -]?time|ever|entire history|all history|since (the )?(start|beginning|launch))\b/.test(
      q,
    )
  ) {
    return 'all';
  }
  const counted =
    /\b(?:past|last|previous)\s+(\d+)\s*(day|week|month)s?\b/.exec(q);
  if (counted?.[1] && counted[2]) {
    const count = Number.parseInt(counted[1], 10);
    const days =
      counted[2] === 'day'
        ? count
        : counted[2] === 'week'
          ? count * 7
          : count * 30;
    if (days <= 1) {
      return '1d';
    }
    if (days <= 3) {
      return '3d';
    }
    if (days <= 7) {
      return '7d';
    }
    if (days <= 45) {
      return '30d';
    }
    return '90d';
  }
  if (/\b(today|last 24 hours|past day|yesterday)\b/.test(q)) {
    return '1d';
  }
  if (/\b(this|past|last)\s+week\b/.test(q)) {
    return '7d';
  }
  if (/\b(this|past|last)\s+month\b/.test(q)) {
    return '30d';
  }
  if (/\b(this|past|last)\s+quarter\b/.test(q)) {
    return '90d';
  }
  return null;
};
