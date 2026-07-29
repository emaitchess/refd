// Sub-10% values keep a decimal so a small-but-real rate stays legible, but
// exact zero is not a small value — "0.0%" beside "100%" in one column reads as
// a formatting bug rather than a measurement.
export const pct = (value: number | null | undefined): string => {
  if (value == null) {
    return '—';
  }
  if (value === 0) {
    return '0%';
  }
  return `${(value * 100).toFixed(value >= 0.1 ? 0 : 1)}%`;
};

export const pctDelta = (current: number, previous: number): string => {
  const diff = (current - previous) * 100;
  return `${diff >= 0 ? '↑' : '↓'} ${Math.abs(diff).toFixed(1)}pp`;
};

export const position = (value: number | null | undefined): string => {
  return value == null ? '—' : `#${value.toFixed(1)}`;
};

export {
  SURFACE_LABELS,
  SURFACE_ORDER,
  surfaceLabel,
} from '@refd/core/surfaces';

export const shortDate = (isoDate: string): string => {
  const [, m, d] = isoDate.split('-');
  return `${m}/${d}`;
};

export const timestamp = (epochMs: number | null): string => {
  return epochMs == null
    ? '—'
    : new Date(epochMs).toISOString().replace('T', ' ').slice(0, 16);
};

// Local wall-clock time for conversational rows (chat); pair with a
// `timestamp()` title for the full UTC datetime on hover.
export const clockTime = (epochMs: number): string =>
  new Date(epochMs).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
