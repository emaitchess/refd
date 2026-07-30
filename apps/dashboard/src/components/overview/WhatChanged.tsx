import { METRIC_INFO } from '@refd/core/metric-copy';
import { Link } from 'react-router';
import { MetricInfo } from '@/components/ui';
import { useQuery } from '@/lib/api';
import { pct, position, shortDate, utcClockTime } from '@/lib/format';
import type { ChangeEvent, ChangeRunRef, ChangesResponse } from '@/lib/types';

// "What changed" card: material movements between the last two completed
// runs, derived server-side (api/routes/changes.ts holds the honesty
// guards). Each row links to Home with the event pre-phrased as a question,
// so the agent picks up the investigation where the card leaves off. Until
// two comparable runs exist the card renders nothing — but a quiet
// comparison is worth a line: "no material changes" is itself news.
const value = (event: ChangeEvent, v: number): string =>
  event.unit === 'rank' ? position(v) : pct(v);

// Rows pair `subject` with this chip, so the magnitude is stated once (the
// full `headline` is for consumers that render one string alone).
const deltaText = (event: ChangeEvent): string => {
  const glyph = event.direction === 'up' ? '↑' : '↓';
  if (event.unit !== 'rank') {
    return `${glyph} ${Math.abs(event.delta * 100).toFixed(0)}pp`;
  }
  const ranks = Math.abs(Math.round(event.delta * 10) / 10);
  const amount = Number.isInteger(ranks) ? ranks.toFixed(0) : ranks.toFixed(1);
  return `${glyph} ${amount} rank${ranks === 1 ? '' : 's'}`;
};

export const WhatChanged = () => {
  const { data } = useQuery<ChangesResponse>('/changes');
  if (
    data?.status !== 'ok' ||
    !data.latest ||
    !data.previous ||
    data.cells == null
  ) {
    return null;
  }
  const events = data.events ?? [];
  // Two runs can share a date (an onboarding pair, or a manual re-run on a
  // cron day); the completion time is what tells them apart.
  const withTime =
    data.latest.date === data.previous.date &&
    data.latest.completedAt != null &&
    data.previous.completedAt != null;
  const runLabel = (run: ChangeRunRef): string =>
    withTime && run.completedAt != null
      ? `${shortDate(run.date)} ${utcClockTime(run.completedAt)}`
      : shortDate(run.date);
  return (
    <section
      aria-labelledby="what-changed"
      className="mb-8 overflow-hidden border border-border"
    >
      <header className="flex min-h-10 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-border border-b bg-bg-elevated px-5 py-2.5">
        <div className="flex items-center gap-1">
          <h2 id="what-changed" className="section-label text-primary">
            What changed
          </h2>
          <MetricInfo
            label="what changed"
            metric={METRIC_INFO.materialChange}
          />
        </div>
        <span className="font-mono text-[10px] text-muted uppercase tracking-[0.1em]">
          {runLabel(data.previous)} → {runLabel(data.latest)} · {data.cells}{' '}
          cells across {data.promptCount} prompts and {data.surfaceCount}{' '}
          surfaces
        </span>
      </header>

      {events.length === 0 ? (
        <p className="px-5 py-3 text-[13px] text-muted">
          No material changes between the last two runs.
        </p>
      ) : (
        <ul>
          {events.map((event) => (
            <li
              key={`${event.type}:${event.scope}:${event.entity}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 border-border border-t px-5 py-2.5 first:border-t-0"
            >
              <span
                aria-hidden
                className={`font-mono text-[12px] ${event.good ? 'text-success' : 'text-error'}`}
              >
                {event.direction === 'up' ? '↑' : '↓'}
              </span>
              <span className="min-w-0 flex-1 text-[13px] text-primary">
                {event.subject}
              </span>
              <span className="font-mono text-[11px] text-secondary">
                {value(event, event.previous)} → {value(event, event.current)}
              </span>
              <span
                className={`font-mono text-[11px] ${event.good ? 'text-success' : 'text-error'}`}
              >
                {deltaText(event)}
              </span>
              <Link
                to={`/home?ask=${encodeURIComponent(event.question)}`}
                className="btn-ghost h-7 px-2 font-mono text-[11px]"
              >
                ask
              </Link>
            </li>
          ))}
        </ul>
      )}

      {data.entitySetChanged ? (
        <p className="border-border border-t px-5 py-2 font-mono text-[10px] text-muted">
          tracked set changed between these runs · share of voice, position, and
          competitor comparisons paused
        </p>
      ) : null}
    </section>
  );
};
