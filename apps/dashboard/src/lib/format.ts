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

// UTC time-of-day, for pairing with a run's date: run dates are UTC, so a
// local-clock time could name an hour that belongs to the neighbouring date.
export const utcClockTime = (epochMs: number): string =>
  new Date(epochMs).toISOString().slice(11, 16);

// Local wall-clock time for conversational rows (chat); pair with a
// `timestamp()` title for the full UTC datetime on hover.
export const clockTime = (epochMs: number): string =>
  new Date(epochMs).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

// Conversational age for chat rows: coarse buckets stay legible while fresh,
// then fall back to a short local date, since older threads are found by
// scanning the list, not by doing the subtraction.
export const relativeTime = (epochMs: number): string => {
  const elapsed = Math.max(0, Date.now() - epochMs) / 1000;
  if (elapsed < 60) {
    return 'now';
  }
  const minutes = Math.floor(elapsed / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d`;
  }
  return new Date(epochMs).toLocaleDateString([], {
    month: '2-digit',
    day: '2-digit',
  });
};

// Day divider labels for the chat thread: relative while recent, absolute
// once the thread spans days.
export const dayLabel = (epochMs: number): string => {
  const now = new Date();
  const date = new Date(epochMs);
  if (date.toDateString() === now.toDateString()) {
    return 'today';
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return 'yesterday';
  }
  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
};
