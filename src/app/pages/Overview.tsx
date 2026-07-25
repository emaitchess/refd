import {
  type CollisionDetection,
  closestCenter,
  type Modifier,
} from '@dnd-kit/core';
import { horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { type ReactNode, useMemo } from 'react';
import { Link } from 'react-router';
import { RangePicker, useRange } from '@/components/controls/RangePicker';
import { Area, Line } from '@/components/dither-kit/area';
import { AreaChart, LineChart } from '@/components/dither-kit/area-chart';
import { Bar } from '@/components/dither-kit/bar';
import { BarChart } from '@/components/dither-kit/bar-chart';
import { Grid } from '@/components/dither-kit/grid';
import { Legend } from '@/components/dither-kit/legend';
import { ChartTooltip } from '@/components/dither-kit/tooltip';
import { XAxis } from '@/components/dither-kit/x-axis';
import { YAxis } from '@/components/dither-kit/y-axis';
import { PageHeader } from '@/components/layout/PageHeader';
import { WhatChanged } from '@/components/overview/WhatChanged';
import {
  moveOrderItem,
  type OrderReorder,
  ROW_DRAG,
  SortableGrid,
  SortableItem,
  useStoredOrder,
} from '@/components/table/sortable';
import { ChartCard, EmptyState, Skeleton, StatTile } from '@/components/ui';
import { useQuery } from '@/lib/api';
import { seriesColor } from '@/lib/chart-colors';
import {
  pct,
  pctDelta,
  position,
  SURFACE_ORDER,
  shortDate,
  surfaceLabel,
} from '@/lib/format';
import { METRIC_INFO } from '@/lib/metric-copy';
import type { OverviewResponse } from '@/lib/types';

// ≤4 trend series per the dataviz rules: brand + top competitors by SoV.
const MAX_TREND_SERIES = 4;
const TILE_CLASS = 'min-h-[124px] border-0 bg-bg-elevated';

const TILE_IDS = ['mention', 'sov', 'position', 'citation'];
const CHART_IDS = [
  'mention',
  'surface',
  'sov',
  'mention-cite',
  'position',
  'citation-rate',
  'prominence',
  'sentiment',
];

const lockMentionRateToVerticalAxis: Modifier = ({ active, transform }) =>
  active?.id === 'mention' ? { ...transform, x: 0 } : transform;

const OVERVIEW_CHART_DRAG = [lockMentionRateToVerticalAxis];

const overviewChartCollision: CollisionDetection = (args) => {
  if (args.active.id !== 'mention' || window.innerWidth < 1280) {
    return closestCenter(args);
  }

  const activeCenterY = args.collisionRect.top + args.collisionRect.height / 2;
  let closest:
    | {
        container: (typeof args.droppableContainers)[number];
        value: number;
        left: number;
      }
    | undefined;

  for (const container of args.droppableContainers) {
    const rect = args.droppableRects.get(container.id);
    if (!rect) {
      continue;
    }
    const value = Math.abs(rect.top + rect.height / 2 - activeCenterY);
    if (
      !closest ||
      value < closest.value - 1 ||
      (Math.abs(value - closest.value) <= 1 && rect.left < closest.left)
    ) {
      closest = { container, value, left: rect.left };
    }
  }

  return closest
    ? [
        {
          id: closest.container.id,
          data: {
            droppableContainer: closest.container,
            value: closest.value,
          },
        },
      ]
    : [];
};

const reorderOverviewCharts: OrderReorder = (current, activeId, overId) => {
  if (
    activeId !== 'mention' ||
    !window.matchMedia('(min-width: 1280px)').matches
  ) {
    return moveOrderItem(current, activeId, overId);
  }

  const rows: string[][] = [];
  let pending: string[] = [];
  for (const id of current) {
    if (id === 'mention') {
      if (pending.length > 0) {
        rows.push(pending);
        pending = [];
      }
      rows.push([id]);
      continue;
    }
    pending.push(id);
    if (pending.length === 2) {
      rows.push(pending);
      pending = [];
    }
  }
  if (pending.length > 0) {
    rows.push(pending);
  }

  const activeRowIndex = rows.findIndex((row) => row.includes(activeId));
  const overRowIndex = rows.findIndex((row) => row.includes(overId));
  const activeRow = rows[activeRowIndex];
  const overRow = rows[overRowIndex];
  if (
    activeRowIndex < 0 ||
    overRowIndex < 0 ||
    activeRowIndex === overRowIndex ||
    !activeRow ||
    !overRow
  ) {
    return current;
  }
  rows[activeRowIndex] = overRow;
  rows[overRowIndex] = activeRow;
  return rows.flat();
};

// Delta only when both windows have a defined value — "—" never gets a delta.
const rateDelta = (
  current: number | null | undefined,
  previous: number | null | undefined,
): string | null =>
  current != null && previous != null ? pctDelta(current, previous) : null;

export const Overview = () => {
  const [range, setRange] = useRange();
  const { data, loading, error, refetch } = useQuery<OverviewResponse>(
    `/overview?range=${range}`,
  );
  const displayedRange = data?.range ?? range;
  const statusText = loading
    ? data
      ? 'updating'
      : 'loading'
    : data
      ? `${data.series.length} run${data.series.length === 1 ? '' : 's'}`
      : 'unavailable';

  const trend = useMemo(() => {
    if (!data) {
      return null;
    }
    const ordered = [...data.entities].sort(
      (a, b) => a.sortOrder - b.sortOrder,
    );
    const latest = data.series.at(-1);
    const competitors = ordered
      .filter((e) => !e.isBrand)
      .sort((a, b) => {
        const sovA = latest?.entities[String(a.id)]?.sov ?? 0;
        const sovB = latest?.entities[String(b.id)]?.sov ?? 0;
        return sovB - sovA;
      })
      .slice(0, MAX_TREND_SERIES - 1);
    const shown = [ordered.find((e) => e.isBrand), ...competitors].filter(
      (e): e is NonNullable<typeof e> => e != null,
    );
    const dateCounts = new Map<string, number>();
    // Runs where the tracked entity set changed get a break marker (*) on the
    // x label: SOV/position shifts there are mechanical, not visibility events.
    const breaks = data.series.map(
      (point, i) =>
        i > 0 && point.entitySetHash !== data.series[i - 1]?.entitySetHash,
    );
    const labels = data.series.map((point, i) => {
      const seen = (dateCounts.get(point.date) ?? 0) + 1;
      dateCounts.set(point.date, seen);
      const hasDupes =
        data.series.filter((s) => s.date === point.date).length > 1;
      const base = hasDupes
        ? `${shortDate(point.date)}·${seen}`
        : shortDate(point.date);
      return breaks[i] ? `${base}*` : base;
    });
    const pct1 = (v: number) => Math.round(v * 1000) / 10;
    const rowsFor = (metric: 'mentionRate' | 'sov' | 'citationRate') =>
      data.series.map((point, i) => {
        const row: Record<string, number | string> = { date: labels[i] ?? '' };
        for (const entity of shown) {
          row[`e${entity.id}`] = pct1(
            point.entities[String(entity.id)]?.[metric] ?? 0,
          );
        }
        return row;
      });
    // Brand-only: null positions (not mentioned that run) drop the point.
    const positionRows = data.series.flatMap((point, i) => {
      const pos = point.entities[String(data.brandId)]?.avgPosition;
      return pos == null
        ? []
        : [{ date: labels[i] ?? '', position: Math.round(pos * 10) / 10 }];
    });
    const config = Object.fromEntries(
      shown.map((entity) => [
        `e${entity.id}`,
        { label: entity.name, color: seriesColor(ordered.indexOf(entity)) },
      ]),
    );
    return {
      rows: rowsFor('mentionRate'),
      sovRows: rowsFor('sov'),
      citationRateRows: rowsFor('citationRate'),
      positionRows,
      hasBreaks: breaks.some(Boolean),
      config,
      brandKey: `e${data.brandId}`,
    };
  }, [data]);

  const surfaceRows = useMemo(() => {
    return [...(data?.surfaces ?? [])]
      .sort(
        (a, b) =>
          SURFACE_ORDER.indexOf(a.surface) - SURFACE_ORDER.indexOf(b.surface),
      )
      .map((s) => ({
        surface: surfaceLabel(s.surface),
        mentionRate: Math.round((s.mentionRate ?? 0) * 1000) / 10,
        citationRate: Math.round((s.citationRate ?? 0) * 1000) / 10,
      }));
  }, [data]);

  const prominenceRows = useMemo(() => {
    if (!data?.prominence) {
      return [];
    }
    const { lead, body, list } = data.prominence;
    const total = lead + body + list;
    if (total === 0) {
      return [];
    }
    return [
      { tier: 'lead', share: Math.round((lead / total) * 1000) / 10 },
      { tier: 'body', share: Math.round((body / total) * 1000) / 10 },
      { tier: 'list', share: Math.round((list / total) * 1000) / 10 },
    ];
  }, [data]);

  const sentimentRows = useMemo(() => {
    if (!data?.sentiment) {
      return [];
    }
    const { positive, neutral, negative } = data.sentiment;
    const total = positive + neutral + negative;
    if (total === 0) {
      return [];
    }
    return [
      { stance: 'positive', share: Math.round((positive / total) * 1000) / 10 },
      { stance: 'neutral', share: Math.round((neutral / total) * 1000) / 10 },
      { stance: 'negative', share: Math.round((negative / total) * 1000) / 10 },
    ];
  }, [data]);

  const coverageLine = useMemo(() => {
    if (!data) {
      return null;
    }
    const parts: string[] = [];
    if (data.coverage.aio) {
      const { present, total } = data.coverage.aio;
      parts.push(
        `AI Overviews appeared on ${pct(total === 0 ? null : present / total)} of prompts (${present}/${total})`,
      );
    }
    const sources = [...data.coverage.sources]
      .sort(
        (a, b) =>
          SURFACE_ORDER.indexOf(a.surface) - SURFACE_ORDER.indexOf(b.surface),
      )
      .map(
        (s) =>
          `${surfaceLabel(s.surface)} ${pct(s.total === 0 ? null : s.withSources / s.total)}`,
      );
    if (sources.length > 0) {
      parts.push(`answers carrying sources: ${sources.join(' · ')}`);
    }
    return parts.length > 0 ? parts.join(' · ') : null;
  }, [data]);

  const tiles = data?.tiles.current ?? null;
  const prev = data?.tiles.previous ?? null;
  const tileOrder = useStoredOrder('refd-overview-tiles', TILE_IDS);
  const chartOrder = useStoredOrder(
    'refd-overview-charts',
    CHART_IDS,
    reorderOverviewCharts,
  );

  const tileDefs: Record<
    string,
    (handleProps: Record<string, unknown>) => ReactNode
  > = {
    mention: (handleProps) => (
      <StatTile
        label="Mention rate"
        info={METRIC_INFO.mentionRate}
        value={pct(tiles?.mentionRate)}
        delta={rateDelta(tiles?.mentionRate, prev?.mentionRate)}
        deltaGood={
          tiles?.mentionRate != null &&
          prev?.mentionRate != null &&
          tiles.mentionRate >= prev.mentionRate
        }
        spark={
          tiles ? (
            <p className="font-mono text-[11px] text-muted">
              {tiles.answers} answers
            </p>
          ) : null
        }
        handleProps={handleProps}
        className={TILE_CLASS}
      />
    ),
    sov: (handleProps) => (
      <StatTile
        label="Share of voice"
        info={METRIC_INFO.shareOfVoice}
        value={pct(tiles?.sov)}
        delta={rateDelta(tiles?.sov, prev?.sov)}
        deltaGood={
          tiles?.sov != null && prev?.sov != null && tiles.sov >= prev.sov
        }
        spark={
          data && !data.hasCompetitors ? (
            <p className="font-mono text-[11px] text-muted">
              add a competitor to compare
            </p>
          ) : tiles?.firstMentionShare != null ? (
            <p className="font-mono text-[11px] text-muted">
              named first {pct(tiles.firstMentionShare)} of the time
            </p>
          ) : null
        }
        handleProps={handleProps}
        className={TILE_CLASS}
      />
    ),
    position: (handleProps) => (
      <StatTile
        label="Avg position"
        info={METRIC_INFO.averagePosition}
        value={position(tiles?.avgPosition)}
        delta={
          tiles?.avgPosition != null && prev?.avgPosition != null
            ? `${tiles.avgPosition <= prev.avgPosition ? '↑' : '↓'} ${Math.abs(tiles.avgPosition - prev.avgPosition).toFixed(2)}`
            : null
        }
        deltaGood={
          tiles?.avgPosition != null &&
          prev?.avgPosition != null &&
          tiles.avgPosition <= prev.avgPosition
        }
        spark={
          tiles?.avgPosition != null && tiles.mentionRate != null ? (
            <p className="font-mono text-[11px] text-muted">
              when mentioned ({pct(tiles.mentionRate)} of answers)
            </p>
          ) : null
        }
        handleProps={handleProps}
        className={TILE_CLASS}
      />
    ),
    citation: (handleProps) => (
      <StatTile
        label="Citation rate"
        info={METRIC_INFO.citationRate}
        value={pct(tiles?.citationRate)}
        delta={rateDelta(tiles?.citationRate, prev?.citationRate)}
        deltaGood={
          tiles?.citationRate != null &&
          prev?.citationRate != null &&
          tiles.citationRate >= prev.citationRate
        }
        spark={
          tiles?.citationSov != null ? (
            <p className="font-mono text-[11px] text-muted">
              citation SOV {pct(tiles.citationSov)}
            </p>
          ) : null
        }
        handleProps={handleProps}
        className={TILE_CLASS}
      />
    ),
  };

  const breakNote = trend?.hasBreaks ? ' · * tracked set changed' : '';
  const chartDefs: Record<string, { title: ReactNode; body: ReactNode }> = {
    mention: {
      title: (
        <>
          mention rate % · per run · {displayedRange}
          {breakNote}
        </>
      ),
      body:
        trend && trend.rows.length >= 2 ? (
          <AreaChart
            data={trend.rows}
            config={trend.config}
            bloom="low"
            margins={{ top: 32 }}
            className="h-64 w-full sm:h-72"
          >
            <Grid />
            <XAxis dataKey="date" />
            <YAxis tickFormatter={(v) => `${Math.round(v)}%`} />
            {Object.keys(trend.config).map((key) =>
              key === trend.brandKey ? (
                <Area key={key} dataKey={key} variant="gradient" />
              ) : (
                <Line key={key} dataKey={key} />
              ),
            )}
            <Legend />
            <ChartTooltip />
          </AreaChart>
        ) : (
          <EmptyState
            title="collecting data"
            hint={`${trend?.rows.length ?? 0} run${trend?.rows.length === 1 ? '' : 's'} so far. Trends appear once two or more runs exist in this range.`}
            className="min-h-64 sm:min-h-72"
          />
        ),
    },
    surface: {
      title: <>brand mention rate % · by surface · {displayedRange}</>,
      body:
        surfaceRows.length > 0 ? (
          <BarChart
            data={surfaceRows}
            config={{
              mentionRate: { label: 'mention rate', color: seriesColor(0) },
            }}
            className="h-64 w-full"
          >
            <Grid />
            <XAxis dataKey="surface" />
            <YAxis tickFormatter={(v) => `${Math.round(v)}%`} />
            <Bar dataKey="mentionRate" />
            <ChartTooltip />
          </BarChart>
        ) : (
          <EmptyState title="no surface data in range" className="min-h-64" />
        ),
    },
    sov: {
      title: (
        <>
          share of voice % · per run · {displayedRange}
          {breakNote}
        </>
      ),
      body:
        data && !data.hasCompetitors ? (
          <EmptyState
            title="share of voice needs competitors"
            hint="Add at least one competitor to compare your share of the conversation."
            className="min-h-64"
            action={
              <Link to="/competitors" className="btn-secondary">
                add competitor
              </Link>
            }
          />
        ) : trend && trend.sovRows.length >= 2 ? (
          <LineChart
            data={trend.sovRows}
            config={trend.config}
            margins={{ top: 32 }}
            className="h-64 w-full"
          >
            <Grid />
            <XAxis dataKey="date" />
            <YAxis tickFormatter={(v) => `${Math.round(v)}%`} />
            {Object.keys(trend.config).map((key) => (
              <Line key={key} dataKey={key} />
            ))}
            <Legend />
            <ChartTooltip />
          </LineChart>
        ) : (
          <EmptyState title="collecting data" className="min-h-64" />
        ),
    },
    'mention-cite': {
      title: <>mentioned vs cited % · by surface · {displayedRange}</>,
      body:
        surfaceRows.length > 0 ? (
          <BarChart
            data={surfaceRows}
            config={{
              mentionRate: { label: 'mentioned', color: seriesColor(0) },
              citationRate: { label: 'cited', color: 'blue' },
            }}
            margins={{ top: 32 }}
            className="h-64 w-full"
          >
            <Grid />
            <XAxis dataKey="surface" />
            <YAxis tickFormatter={(v) => `${Math.round(v)}%`} />
            <Bar dataKey="mentionRate" />
            <Bar dataKey="citationRate" />
            <Legend />
            <ChartTooltip />
          </BarChart>
        ) : (
          <EmptyState title="no surface data in range" className="min-h-64" />
        ),
    },
    position: {
      title: (
        <>
          brand avg position · per run · lower is better · {displayedRange}
          {breakNote}
        </>
      ),
      body:
        trend && trend.positionRows.length >= 2 ? (
          <LineChart
            data={trend.positionRows}
            config={{
              position: { label: 'avg position', color: seriesColor(0) },
            }}
            className="h-64 w-full"
          >
            <Grid />
            <XAxis dataKey="date" />
            <YAxis tickFormatter={(v) => `#${v}`} />
            <Line dataKey="position" />
            <ChartTooltip />
          </LineChart>
        ) : (
          <EmptyState
            title="collecting data"
            hint="Position needs runs where the brand was mentioned."
            className="min-h-64"
          />
        ),
    },
    'citation-rate': {
      title: <>citation rate % · per run · {displayedRange}</>,
      body:
        trend && trend.citationRateRows.length >= 2 ? (
          <AreaChart
            data={trend.citationRateRows}
            config={{
              [trend.brandKey]: { label: 'cited', color: seriesColor(0) },
            }}
            className="h-64 w-full"
          >
            <Grid />
            <XAxis dataKey="date" />
            <YAxis tickFormatter={(v) => `${Math.round(v)}%`} />
            <Area dataKey={trend.brandKey} variant="gradient" />
            <ChartTooltip />
          </AreaChart>
        ) : (
          <EmptyState title="collecting data" className="min-h-64" />
        ),
    },
    prominence: {
      title: <>brand prominence · share of mentions · {displayedRange}</>,
      body:
        prominenceRows.length > 0 ? (
          <BarChart
            data={prominenceRows}
            config={{ share: { label: 'share', color: seriesColor(0) } }}
            className="h-64 w-full"
          >
            <Grid />
            <XAxis dataKey="tier" />
            <YAxis tickFormatter={(v) => `${Math.round(v)}%`} />
            <Bar dataKey="share" />
            <ChartTooltip />
          </BarChart>
        ) : (
          <EmptyState
            title="no mentions in range"
            hint="Prominence tiers appear once the brand is mentioned."
            className="min-h-64"
          />
        ),
    },
    sentiment: {
      title: (
        <>brand sentiment · share of classified mentions · {displayedRange}</>
      ),
      body:
        sentimentRows.length > 0 ? (
          <BarChart
            data={sentimentRows}
            config={{ share: { label: 'share', color: seriesColor(0) } }}
            className="h-64 w-full"
          >
            <Grid />
            <XAxis dataKey="stance" />
            <YAxis tickFormatter={(v) => `${Math.round(v)}%`} />
            <Bar dataKey="share" />
            <ChartTooltip />
          </BarChart>
        ) : (
          <EmptyState
            title="no classified mentions"
            hint="New runs classify how answers portray the brand once it is mentioned."
            className="min-h-64"
          />
        ),
    },
  };

  return (
    <>
      <PageHeader
        title="Overview"
        description="Track visibility, share of voice, position, and citations across every monitored AI surface."
        actions={
          <>
            <span
              aria-live="polite"
              className="hidden font-mono text-[10px] text-muted uppercase tracking-[0.1em] sm:inline"
            >
              {statusText}
            </span>
            <RangePicker value={range} onChange={setRange} />
          </>
        }
      />

      {error && data ? (
        <div
          role="alert"
          className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 border border-error px-4 py-3"
        >
          <span className="font-mono text-[10px] text-error uppercase tracking-[0.12em]">
            Update failed
          </span>
          <span className="text-[13px] text-secondary">{error}</span>
          <button
            type="button"
            onClick={refetch}
            className="btn-ghost ml-auto h-7 px-2"
          >
            retry
          </button>
        </div>
      ) : null}

      {!data && !loading ? (
        <EmptyState
          title="overview unavailable"
          hint={error ?? 'The overview could not be loaded.'}
          action={
            <button type="button" onClick={refetch} className="btn-secondary">
              retry
            </button>
          }
        />
      ) : (
        <>
          <section
            aria-labelledby="overview-snapshot"
            aria-busy={loading}
            className="mb-8 overflow-hidden border border-border"
          >
            <header className="flex min-h-10 items-center justify-between gap-3 border-border border-b bg-bg-elevated px-5 py-2.5">
              <h2 id="overview-snapshot" className="section-label text-primary">
                Performance snapshot
              </h2>
            </header>

            {loading && !data ? (
              <div className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2 xl:grid-cols-4">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="min-h-[124px] bg-bg-elevated" />
                ))}
              </div>
            ) : (
              <SortableGrid
                order={tileOrder.order}
                onDragEnd={tileOrder.onDragEnd}
                modifiers={ROW_DRAG}
                strategy={horizontalListSortingStrategy}
                className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2 xl:grid-cols-4"
              >
                {tileOrder.order.map((id) => (
                  <SortableItem key={id} id={id}>
                    {(handleProps) => tileDefs[id]?.(handleProps)}
                  </SortableItem>
                ))}
              </SortableGrid>
            )}

            {coverageLine ? (
              <div className="flex flex-wrap gap-x-4 gap-y-1 border-border border-t px-5 py-3">
                <span className="font-mono text-[10px] text-primary uppercase tracking-[0.12em]">
                  Coverage
                </span>
                <p className="font-mono text-[11px] text-muted leading-relaxed">
                  {coverageLine}
                </p>
              </div>
            ) : null}
          </section>

          <WhatChanged />

          <section aria-labelledby="overview-details" aria-busy={loading}>
            <header className="mb-4 flex items-end justify-between gap-4">
              <div>
                <h2
                  id="overview-details"
                  className="font-medium text-[17px] text-primary tracking-[-0.015em]"
                >
                  Trends and breakdowns
                </h2>
                <p className="mt-1 text-[13px] text-muted">
                  Compare run-by-run movement and performance across AI
                  surfaces.
                </p>
              </div>
            </header>

            {loading && !data ? (
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {CHART_IDS.map((id) => (
                  <Skeleton
                    key={id}
                    className={
                      id === 'mention'
                        ? 'h-[370px] border border-border xl:col-span-2'
                        : 'h-[338px] border border-border'
                    }
                  />
                ))}
              </div>
            ) : (
              <SortableGrid
                order={chartOrder.order}
                onDragEnd={chartOrder.onDragEnd}
                modifiers={OVERVIEW_CHART_DRAG}
                collisionDetection={overviewChartCollision}
                className="grid grid-cols-1 gap-4 xl:grid-cols-2"
              >
                {chartOrder.order.map((id) => {
                  const def = chartDefs[id];
                  if (!def) {
                    return null;
                  }
                  return (
                    <SortableItem
                      key={id}
                      id={id}
                      className={id === 'mention' ? 'xl:col-span-2' : undefined}
                    >
                      {(handleProps) => (
                        <ChartCard
                          title={def.title}
                          handleProps={handleProps}
                          className="h-full"
                        >
                          {def.body}
                        </ChartCard>
                      )}
                    </SortableItem>
                  );
                })}
              </SortableGrid>
            )}
          </section>
        </>
      )}
    </>
  );
};
