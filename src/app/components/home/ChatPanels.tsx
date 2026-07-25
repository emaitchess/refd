import { sentimentSplit } from '@/components/ui';
import { pct, position, surfaceLabel } from '@/lib/format';
import type { SentimentDist } from '@/lib/types';

// Renders the data panels an assistant answer selected, from the panelData
// frozen on the message. The shapes come from the server digest but arrive
// as stored JSON, so every renderer guards its fields and skips quietly on
// drift — a panel must never crash a conversation.
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const arr = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v)
    ? v.filter(
        (x): x is Record<string, unknown> =>
          typeof x === 'object' && x !== null,
      )
    : [];
const rec = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;

const dist = (v: unknown): SentimentDist => {
  const r = rec(v);
  if (!r) {
    return null;
  }
  const positive = num(r.positive);
  const neutral = num(r.neutral);
  const negative = num(r.negative);
  return positive === null || neutral === null || negative === null
    ? null
    : { positive, neutral, negative };
};

const PanelFrame = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <div className="overflow-hidden border border-border bg-bg-card">
    <p className="section-label border-border border-b bg-bg-elevated px-3 py-2">
      {label}
    </p>
    <div className="overflow-x-auto p-3">{children}</div>
  </div>
);

const MiniTable = ({
  head,
  rows,
}: {
  head: string[];
  rows: (string | number)[][];
}) => (
  <table className="w-full border-collapse text-[12px]">
    <thead>
      <tr>
        {head.map((h, i) => (
          <th
            key={h}
            className={
              i === 0
                ? 'pb-1.5 text-left font-normal text-[10px] text-muted uppercase tracking-[0.08em]'
                : 'pb-1.5 text-right font-normal text-[10px] text-muted uppercase tracking-[0.08em]'
            }
          >
            {h}
          </th>
        ))}
      </tr>
    </thead>
    <tbody>
      {rows.map((cells, rowIndex) => (
        // Static frozen data: index keys are safe, rows never reorder.
        <tr key={rowIndex} className="border-border border-t">
          {cells.map((cell, i) => (
            <td
              key={i}
              className={
                i === 0
                  ? 'max-w-[220px] truncate py-1 pr-2 text-primary'
                  : 'py-1 pl-2 text-right font-mono text-primary tabular-nums'
              }
            >
              {cell}
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  </table>
);

const StatRow = ({ items }: { items: [string, string][] }) => (
  <div className="flex flex-wrap gap-x-6 gap-y-2">
    {items.map(([label, value]) => (
      <div key={label} className="min-w-20">
        <p className="font-mono text-[10px] text-muted uppercase tracking-[0.08em]">
          {label}
        </p>
        <p className="mt-1 font-mono text-[18px] text-primary leading-none">
          {value}
        </p>
      </div>
    ))}
  </div>
);

const renderPanel = (
  key: string,
  data: unknown,
  windowLabel: string,
): React.ReactNode => {
  if (key === 'overview') {
    const d = rec(data);
    if (!d) {
      return null;
    }
    return (
      <PanelFrame label={`overview · ${windowLabel}`}>
        <StatRow
          items={[
            ['mention rate', pct(num(d.mentionRate))],
            ['share of voice', pct(num(d.sov))],
            ['citation rate', pct(num(d.citationRate))],
            ['avg position', position(num(d.avgPosition))],
            ['sentiment +/·/−', sentimentSplit(dist(d.sentiment))],
          ]}
        />
      </PanelFrame>
    );
  }
  if (key === 'surfaces') {
    const rows = arr(data);
    if (rows.length === 0) {
      return null;
    }
    return (
      <PanelFrame label="by surface">
        <MiniTable
          head={['surface', 'mentioned', 'cited', 'position']}
          rows={rows.map((s) => [
            surfaceLabel(str(s.surface)),
            pct(num(s.mentionRate)),
            pct(num(s.citationRate)),
            position(num(s.avgPosition)),
          ])}
        />
      </PanelFrame>
    );
  }
  if (key === 'competitors') {
    const rows = arr(data);
    if (rows.length === 0) {
      return null;
    }
    return (
      <PanelFrame label="you vs competitors">
        <MiniTable
          head={['entity', 'mentioned', 'SOV', 'position', 'sentiment']}
          rows={rows.map((e) => [
            `${str(e.name)}${e.isBrand === true ? ' (you)' : ''}`,
            pct(num(e.mentionRate)),
            pct(num(e.sov)),
            position(num(e.avgPosition)),
            sentimentSplit(dist(e.sentiment)),
          ])}
        />
      </PanelFrame>
    );
  }
  if (key === 'sentiment') {
    const d = dist(rec(data)?.brand);
    if (!d) {
      return null;
    }
    const total = d.positive + d.neutral + d.negative;
    return (
      <PanelFrame label="brand sentiment">
        <StatRow
          items={[
            ['positive', pct(total ? d.positive / total : null)],
            ['neutral', pct(total ? d.neutral / total : null)],
            ['negative', pct(total ? d.negative / total : null)],
            ['classified mentions', String(total)],
          ]}
        />
      </PanelFrame>
    );
  }
  if (key === 'sources') {
    const d = rec(data);
    const top = arr(d?.topCited);
    const gap = arr(d?.gap);
    if (top.length === 0 && gap.length === 0) {
      return null;
    }
    return (
      <PanelFrame label="sources">
        <div className="grid gap-4 sm:grid-cols-2">
          {top.length > 0 ? (
            <MiniTable
              head={['most cited', 'answers']}
              rows={top.map((s) => [
                `${str(s.domain)}${s.isOurs === true ? ' (you)' : ''}`,
                String(num(s.answersCiting) ?? '—'),
              ])}
            />
          ) : null}
          {gap.length > 0 ? (
            <MiniTable
              head={['source gap', 'answers']}
              rows={gap.map((s) => [
                str(s.domain),
                String(num(s.answersCiting) ?? '—'),
              ])}
            />
          ) : null}
        </div>
      </PanelFrame>
    );
  }
  if (key === 'coverage') {
    const d = rec(data);
    const aio = rec(d?.aio);
    const sources = arr(d?.sources);
    if (!aio && sources.length === 0) {
      return null;
    }
    return (
      <PanelFrame label="coverage">
        <div className="flex flex-col gap-1 font-mono text-[12px] text-secondary">
          {aio ? (
            <p>
              AI Overviews appeared on{' '}
              {pct(
                num(aio.total)
                  ? (num(aio.present) ?? 0) / (num(aio.total) ?? 1)
                  : null,
              )}{' '}
              of prompts
            </p>
          ) : null}
          {sources.length > 0 ? (
            <p>
              answers carrying sources:{' '}
              {sources
                .map(
                  (s) =>
                    `${surfaceLabel(str(s.surface))} ${pct(
                      num(s.total)
                        ? (num(s.withSources) ?? 0) / (num(s.total) ?? 1)
                        : null,
                    )}`,
                )
                .join(' · ')}
            </p>
          ) : null}
        </div>
      </PanelFrame>
    );
  }
  if (key === 'prompts') {
    const d = rec(data);
    const top = arr(d?.top);
    const zero = Array.isArray(d?.zeroVisibility)
      ? d.zeroVisibility.filter((z): z is string => typeof z === 'string')
      : [];
    if (top.length === 0 && zero.length === 0) {
      return null;
    }
    return (
      <PanelFrame label="prompts">
        <div className="grid gap-4 sm:grid-cols-2">
          {top.length > 0 ? (
            <MiniTable
              head={['best visibility', 'mentioned']}
              rows={top.map((p) => [str(p.text), pct(num(p.mentionRate))])}
            />
          ) : null}
          {zero.length > 0 ? (
            <MiniTable
              head={['zero visibility', '']}
              rows={zero.map((text) => [text, ''])}
            />
          ) : null}
        </div>
      </PanelFrame>
    );
  }
  if (key === 'runs') {
    const rows = arr(data);
    if (rows.length === 0) {
      return null;
    }
    return (
      <PanelFrame label="recent runs">
        <MiniTable
          head={['run', 'answers', 'brand mentioned']}
          rows={rows.map((r) => [
            `${str(r.date)} (${str(r.status)})`,
            str(r.answersCollected),
            pct(num(r.brandMentionRate)),
          ])}
        />
      </PanelFrame>
    );
  }
  return null;
};

export const ChatPanels = ({
  panels,
  panelData,
}: {
  panels: string[] | null;
  panelData: Record<string, unknown> | null;
}) => {
  if (!panels || panels.length === 0 || !panelData) {
    return null;
  }
  // The window the answer was grounded under, frozen at answer time.
  const windowLabel = str(panelData._window) || 'last 30 days';
  const rendered = panels
    .map((key) => ({
      key,
      node: renderPanel(key, panelData[key], windowLabel),
    }))
    .filter((p) => p.node !== null);
  if (rendered.length === 0) {
    return null;
  }
  return (
    <div className="mt-3 flex flex-col gap-3">
      {rendered.map((p) => (
        <div key={p.key}>{p.node}</div>
      ))}
    </div>
  );
};
