import type { IFuseOptions } from 'fuse.js';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Select } from '@/components/controls/Select';
import { DitherIcon } from '@/components/dither/DitherIcon';
import { Tooltip } from '@/components/dither-kit/tooltip';
import { useToast } from '@/components/feedback/Toast';
import { PageHeader } from '@/components/layout/PageHeader';
import { ResultPane } from '@/components/panes/ResultPane';
import { SurfaceLogo } from '@/components/svgs/SurfaceLogo';
import {
  ColGroup,
  ColResizer,
  type ColumnSpec,
  Pagination,
  rowActivation,
  type SortAccessors,
  Th,
  useColumnWidths,
  usePagination,
  useSort,
} from '@/components/table/table';
import {
  Badge,
  Card,
  EmptyState,
  OverflowTooltip,
  SentimentTag,
  Skeleton,
  StatTile,
} from '@/components/ui';
import {
  type UseFuzzySearchOptions,
  useFuzzySearch,
} from '@/hooks/useFuzzySearch';
import { api, apiPath, useAsyncAction, useQuery } from '@/lib/api';
import { pct, SURFACE_ORDER, surfaceLabel, timestamp } from '@/lib/format';
import type { RunResultRow, RunRow } from '@/lib/types';
import { cn } from '@/lib/utils';

const ALL_STATUSES = 'all statuses';
const ALL_TRIGGERS = 'all triggers';
const RUN_STATUS_OPTIONS = [ALL_STATUSES, 'running', 'complete', 'failed'];
const RUN_TRIGGER_OPTIONS = [
  ALL_TRIGGERS,
  'scheduled',
  'manual',
  'onboarding',
  'import',
];

const ALL_SURFACES = 'all surfaces';
const ALL_OUTCOMES = 'all outcomes';
const RESULT_OUTCOME_OPTIONS = [
  ALL_OUTCOMES,
  'successful',
  'no AI Overview',
  'failed',
  'pending',
];

const RUN_COLUMNS: ColumnSpec[] = [
  { key: 'run', min: 220, fraction: 0.25 },
  { key: 'trigger', min: 112, fraction: 0.12 },
  { key: 'status', min: 120, fraction: 0.13 },
  { key: 'results', min: 160, fraction: 0.18 },
  { key: 'duration', min: 100, fraction: 0.12 },
  { key: 'started', min: 180, fraction: 0.2 },
];

const RESULT_COLUMNS: ColumnSpec[] = [
  { key: 'prompt', min: 280, fraction: 0.29 },
  { key: 'surface', min: 130, fraction: 0.13 },
  { key: 'status', min: 120, fraction: 0.13 },
  { key: 'brand', min: 140, fraction: 0.14 },
  { key: 'sentiment', min: 96, fraction: 0.1 },
  { key: 'urls', min: 72, fraction: 0.07 },
  { key: 'duration', min: 96, fraction: 0.08 },
  { key: 'raw', min: 72, fraction: 0.06 },
];

const RUN_SORTS: SortAccessors<RunRow> = {
  run: (row) => row.id,
  trigger: (row) => row.trigger,
  status: (row) => row.status,
  results: (row) =>
    row.totalCount === 0 ? null : row.okCount / row.totalCount,
  duration: (row) =>
    row.completedAt === null ? null : row.completedAt - row.createdAt,
  started: (row) => row.createdAt,
};

const promptResultSort = (row: RunResultRow) => row.promptText.toLowerCase();

// Single-result stance ordering: positive above neutral above negative,
// unclassified last (nulls sort last).
const SENTIMENT_RANK = { positive: 2, neutral: 1, negative: 0 } as const;

const BASE_RESULT_SORTS: SortAccessors<RunResultRow> = {
  prompt: promptResultSort,
  surface: (row) => row.surface,
  status: (row) => (row.ok ? (row.answerPresent ? 2 : 1) : 0),
  brand: (row) => row.brandMentioned * 2 + row.brandCited,
  sentiment: (row) =>
    row.brandSentiment === null ? null : SENTIMENT_RANK[row.brandSentiment],
  urls: (row) => row.totalUrls,
  duration: (row) => row.durationMs,
  raw: (row) => row.hasRaw,
};

const EMPTY_RUNS: RunRow[] = [];
const EMPTY_RESULTS: RunResultRow[] = [];
const RESULT_FUSE_OPTIONS: IFuseOptions<RunResultRow> = {
  keys: ['promptText'],
  threshold: 0.36,
  ignoreDiacritics: true,
  ignoreLocation: true,
  includeScore: true,
  useTokenSearch: true,
};
const RESULT_SEARCH_OPTIONS: UseFuzzySearchOptions<RunResultRow> = {
  fuseOptions: RESULT_FUSE_OPTIONS,
};
const TILE_CLASS = 'min-h-[124px] border-0 bg-bg-elevated';

const triggerLabel = (trigger: RunRow['trigger']) => {
  if (trigger === 'cron') {
    return 'scheduled';
  }
  if (trigger === 'onboard') {
    return 'onboarding';
  }
  return trigger;
};

const durationLabel = (milliseconds: number | null) => {
  if (milliseconds === null) {
    return '—';
  }
  const seconds = Math.max(0, milliseconds) / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
};

const runDuration = (run: RunRow) =>
  run.completedAt === null ? null : run.completedAt - run.createdAt;

const StatusBadge = ({ status }: { status: RunRow['status'] }) => {
  if (status === 'complete') {
    return <Badge tone="ok">complete</Badge>;
  }
  if (status === 'failed') {
    return <Badge tone="fail">failed</Badge>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-secondary">
      <span className="size-1.5 animate-pulse bg-warning motion-reduce:animate-none" />
      running
    </span>
  );
};

const ResultStatus = ({ row }: { row: RunResultRow }) => {
  if (row.ok && row.answerPresent) {
    return <Badge tone="ok">successful</Badge>;
  }
  if (row.ok) {
    return <Badge tone="neutral">no AI Overview</Badge>;
  }
  return (
    <Badge tone={row.error ? 'fail' : 'neutral'}>
      {row.error ? 'failed' : 'pending'}
    </Badge>
  );
};

const resultOutcome = (row: RunResultRow) => {
  if (row.ok && row.answerPresent) {
    return 'successful';
  }
  if (row.ok) {
    return 'no AI Overview';
  }
  return row.error ? 'failed' : 'pending';
};

const TableEmptyRow = ({
  colSpan,
  title,
  hint,
  action,
}: {
  colSpan: number;
  title: string;
  hint: string;
  action?: ReactNode;
}) => (
  <tr>
    <td colSpan={colSpan} className="border-border border-t px-4 py-10">
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="section-label">{title}</span>
        <p className="text-[13px] text-muted">{hint}</p>
        {action ? <div className="mt-1">{action}</div> : null}
      </div>
    </td>
  </tr>
);

const TableSkeleton = ({
  columns,
  rows = 6,
}: {
  columns: ColumnSpec[];
  rows?: number;
}) =>
  Array.from({ length: rows }, (_, rowIndex) => (
    <tr key={`run-skeleton-${columns.length}-${rowIndex}`}>
      {columns.map((column) => (
        <td key={column.key} className="h-10 border-border border-t px-3">
          <Skeleton
            className={cn(
              'h-3',
              column.key === 'run' || column.key === 'prompt'
                ? 'w-3/5'
                : 'ml-auto w-12',
            )}
          />
        </td>
      ))}
    </tr>
  ));

export const Runs = () => {
  const navigate = useNavigate();
  const { data, loading, error, refetch } = useQuery<{ runs: RunRow[] }>(
    '/runs',
  );
  const rows = data?.runs ?? EMPTY_RUNS;
  const [statusFilter, setStatusFilter] = useState(ALL_STATUSES);
  const [triggerFilter, setTriggerFilter] = useState(ALL_TRIGGERS);
  const columns = useColumnWidths('runs', RUN_COLUMNS);

  const filtered = useMemo(
    () =>
      rows.filter(
        (row) =>
          (statusFilter === ALL_STATUSES || row.status === statusFilter) &&
          (triggerFilter === ALL_TRIGGERS ||
            triggerLabel(row.trigger) === triggerFilter),
      ),
    [rows, statusFilter, triggerFilter],
  );
  const { sorted, sort, toggle } = useSort(filtered, RUN_SORTS, {
    key: 'run',
    dir: 'desc',
  });
  const pageState = usePagination(sorted, 25);
  const anyRunning = rows.some((row) => row.status === 'running');
  const hasFilters =
    statusFilter !== ALL_STATUSES || triggerFilter !== ALL_TRIGGERS;
  const clearFilters = () => {
    setStatusFilter(ALL_STATUSES);
    setTriggerFilter(ALL_TRIGGERS);
  };
  const resetTable = () => {
    clearFilters();
    pageState.setPage(0);
    columns.reset();
  };

  useEffect(() => pageState.setPage(0), [statusFilter, triggerFilter]);
  useEffect(() => {
    if (!anyRunning) {
      return;
    }
    const timer = setInterval(refetch, 10_000);
    return () => clearInterval(timer);
  }, [anyRunning, refetch]);

  const completed = rows.filter((row) => row.status === 'complete').length;
  const okUnits = rows.reduce((sum, row) => sum + row.okCount, 0);
  const totalUnits = rows.reduce((sum, row) => sum + row.totalCount, 0);
  const successRate = totalUnits ? okUnits / totalUnits : null;
  const resultSummary = loading
    ? 'loading'
    : hasFilters
      ? `${filtered.length} of ${rows.length}`
      : `${rows.length} runs`;

  const resizer = (key: string, label: string) => (
    <ColResizer
      label={label}
      onStart={(clientX) => columns.startResize(key, clientX)}
      onNudge={(direction) => columns.nudge(key, direction)}
      onReset={columns.reset}
    />
  );

  return (
    <>
      <PageHeader
        title="Runs"
        description="Inspect scheduled and manual collection runs, their completion, and every captured answer."
      />

      {error && data ? (
        <div
          role="alert"
          className="mb-4 flex items-center justify-between gap-4 border border-error/30 bg-error/5 px-4 py-3"
        >
          <p className="text-[13px] text-error">{error}</p>
          <button type="button" className="btn-secondary" onClick={refetch}>
            retry
          </button>
        </div>
      ) : null}

      {!loading && !data ? (
        <EmptyState
          title="run history unavailable"
          hint={error ?? 'Runs could not be loaded.'}
          action={
            <button type="button" className="btn-secondary" onClick={refetch}>
              retry
            </button>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          <section
            aria-labelledby="run-snapshot"
            aria-busy={loading}
            className="overflow-hidden border border-border"
          >
            <header className="flex min-h-10 items-center border-border border-b bg-bg-elevated px-5 py-2.5">
              <h2 id="run-snapshot" className="section-label text-primary">
                Operational snapshot
              </h2>
            </header>
            {loading && !data ? (
              <div className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2 xl:grid-cols-4">
                {[0, 1, 2, 3].map((index) => (
                  <Skeleton
                    key={index}
                    className="min-h-[124px] bg-bg-elevated"
                  />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2 xl:grid-cols-4">
                <StatTile
                  label="Runs loaded"
                  value={String(rows.length)}
                  spark={
                    <p className="font-mono text-[11px] text-muted">
                      latest workspace history
                    </p>
                  }
                  className={TILE_CLASS}
                />
                <StatTile
                  label="Completed runs"
                  value={String(completed)}
                  spark={
                    <p className="font-mono text-[11px] text-muted">
                      {rows.length - completed} running or failed
                    </p>
                  }
                  className={TILE_CLASS}
                />
                <StatTile
                  label="Successful units"
                  value={pct(successRate)}
                  spark={
                    <p className="font-mono text-[11px] text-muted">
                      {okUnits}/{totalUnits} collected answers
                    </p>
                  }
                  className={TILE_CLASS}
                />
                <StatTile
                  label="Active runs"
                  value={String(
                    rows.filter((row) => row.status === 'running').length,
                  )}
                  spark={
                    <p className="font-mono text-[11px] text-muted">
                      refreshes every 10 seconds
                    </p>
                  }
                  className={TILE_CLASS}
                />
              </div>
            )}
          </section>

          <Card className="overflow-hidden p-0">
            <div className="flex flex-col gap-3 border-border border-b px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <div className="flex items-baseline gap-3">
                  <span className="section-label">run history</span>
                  <span
                    className="font-mono text-[10px] text-muted uppercase tracking-[0.08em]"
                    aria-live="polite"
                  >
                    {resultSummary}
                  </span>
                </div>
                <p className="mt-1 text-[12px] text-muted">
                  Open a run to inspect individual prompts, surfaces, and raw
                  provider receipts.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center xl:justify-end">
                <Select
                  value={statusFilter}
                  options={RUN_STATUS_OPTIONS}
                  onChange={setStatusFilter}
                  ariaLabel="Filter runs by status"
                  size="sm"
                  className="sm:w-36"
                />
                <Select
                  value={triggerFilter}
                  options={RUN_TRIGGER_OPTIONS}
                  onChange={setTriggerFilter}
                  ariaLabel="Filter runs by trigger"
                  size="sm"
                  className="sm:w-36"
                />
                <button
                  type="button"
                  className="btn-ghost h-8 px-2 font-mono text-[11px]"
                  onClick={resetTable}
                >
                  reset
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table
                ref={columns.tableRef}
                className="w-full min-w-[900px] table-fixed border-collapse text-[13px]"
                aria-busy={loading}
              >
                <caption className="sr-only">
                  Scheduled, manual, onboarding, and imported collection runs.
                </caption>
                <ColGroup columns={RUN_COLUMNS} widths={columns.widths} />
                <thead className="sticky top-12 z-10 lg:top-0">
                  <tr className="bg-bg-elevated shadow-[0_1px_0_var(--color-border)]">
                    <Th
                      label="Run"
                      sortKey="run"
                      sort={sort}
                      onToggle={toggle}
                      className="px-4"
                      resizer={resizer('run', 'run')}
                    />
                    <Th
                      label="Trigger"
                      sortKey="trigger"
                      sort={sort}
                      onToggle={toggle}
                      resizer={resizer('trigger', 'trigger')}
                    />
                    <Th
                      label="Status"
                      sortKey="status"
                      sort={sort}
                      onToggle={toggle}
                      resizer={resizer('status', 'status')}
                    />
                    <Th
                      label="Successful units"
                      sortKey="results"
                      sort={sort}
                      onToggle={toggle}
                      align="right"
                      resizer={resizer('results', 'successful units')}
                    />
                    <Th
                      label="Duration"
                      sortKey="duration"
                      sort={sort}
                      onToggle={toggle}
                      align="right"
                      resizer={resizer('duration', 'duration')}
                    />
                    <Th
                      label="Started UTC"
                      sortKey="started"
                      sort={sort}
                      onToggle={toggle}
                      align="right"
                      className="px-4"
                    />
                  </tr>
                </thead>
                <tbody>
                  {loading && !data ? (
                    <TableSkeleton columns={RUN_COLUMNS} />
                  ) : pageState.view.length === 0 ? (
                    <TableEmptyRow
                      colSpan={RUN_COLUMNS.length}
                      title={hasFilters ? 'no matching runs' : 'no runs yet'}
                      hint={
                        hasFilters
                          ? 'Try another status or trigger filter.'
                          : 'The daily schedule creates one automatically.'
                      }
                      action={
                        hasFilters ? (
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={clearFilters}
                          >
                            clear filters
                          </button>
                        ) : null
                      }
                    />
                  ) : (
                    pageState.view.map((runRow) => {
                      const rate = runRow.totalCount
                        ? runRow.okCount / runRow.totalCount
                        : null;
                      return (
                        <tr
                          key={runRow.id}
                          {...rowActivation(() =>
                            navigate(`/runs/${runRow.id}`),
                          )}
                          className="group cursor-pointer border-border border-t transition-colors hover:bg-bg-card-hover focus-visible:bg-bg-card-hover focus-visible:shadow-[inset_2px_0_0_var(--color-primary)]"
                          aria-label={`Open run ${runRow.id} from ${runRow.date}`}
                        >
                          <td className="px-4 py-2.5">
                            <span className="block truncate text-primary">
                              {runRow.date}
                            </span>
                            <span className="mt-0.5 block font-mono text-[10px] text-muted">
                              run #{runRow.id}
                            </span>
                          </td>
                          <td className="px-2 py-2.5">
                            <Badge tone="neutral">
                              {triggerLabel(runRow.trigger)}
                            </Badge>
                          </td>
                          <td className="px-2 py-2.5">
                            <StatusBadge status={runRow.status} />
                          </td>
                          <td className="px-2 py-2.5 text-right">
                            <span className="font-mono text-[12px] text-primary tabular-nums">
                              {runRow.okCount}/{runRow.totalCount}
                            </span>
                            <span className="ml-2 font-mono text-[10px] text-muted">
                              {pct(rate)}
                            </span>
                          </td>
                          <td className="px-2 py-2.5 text-right font-mono text-[11px] text-secondary tabular-nums">
                            {durationLabel(runDuration(runRow))}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-[11px] text-muted tabular-nums">
                            {timestamp(runRow.createdAt)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <Pagination state={pageState} />
          </Card>
        </div>
      )}
    </>
  );
};

export const RunDetail = () => {
  const { id } = useParams();
  const { data, loading, error, refetch } = useQuery<{
    run: RunRow;
    results: RunResultRow[];
  }>(`/runs/${id}`);
  const rows = data?.results ?? EMPTY_RESULTS;
  const toast = useToast();
  const { busy, error: rescoreError, run: act } = useAsyncAction();
  const [searchQuery, setSearchQuery] = useState('');
  const [surfaceFilter, setSurfaceFilter] = useState(ALL_SURFACES);
  const [outcomeFilter, setOutcomeFilter] = useState(ALL_OUTCOMES);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const columns = useColumnWidths(
    `run-results-${id ?? 'unknown'}`,
    RESULT_COLUMNS,
  );

  const surfaces = useMemo(
    () => [
      ALL_SURFACES,
      ...SURFACE_ORDER.filter((surface) =>
        rows.some((row) => row.surface === surface),
      ).map(surfaceLabel),
    ],
    [rows],
  );
  const filtered = useMemo(
    () =>
      rows.filter(
        (row) =>
          (surfaceFilter === ALL_SURFACES ||
            surfaceLabel(row.surface) === surfaceFilter) &&
          (outcomeFilter === ALL_OUTCOMES ||
            resultOutcome(row) === outcomeFilter),
      ),
    [outcomeFilter, rows, surfaceFilter],
  );
  const search = useFuzzySearch(filtered, searchQuery, RESULT_SEARCH_OPTIONS);
  const searchRanks = useMemo(
    () =>
      new Map(
        search.results.map((result, index) => [result.item.id, index] as const),
      ),
    [search.results],
  );
  const resultSorts = useMemo<SortAccessors<RunResultRow>>(
    () => ({
      ...BASE_RESULT_SORTS,
      prompt: search.hasQuery
        ? (row) => searchRanks.get(row.id) ?? Number.MAX_SAFE_INTEGER
        : promptResultSort,
    }),
    [search.hasQuery, searchRanks],
  );
  const { sorted, sort, toggle } = useSort(search.items, resultSorts, {
    key: 'prompt',
    dir: 'asc',
  });
  const pageState = usePagination(sorted, 25);
  const hasFilters =
    searchQuery.trim().length > 0 ||
    surfaceFilter !== ALL_SURFACES ||
    outcomeFilter !== ALL_OUTCOMES;
  const clearFilters = () => {
    setSearchQuery('');
    setSurfaceFilter(ALL_SURFACES);
    setOutcomeFilter(ALL_OUTCOMES);
  };
  const resetTable = () => {
    clearFilters();
    pageState.setPage(0);
    columns.reset();
  };

  useEffect(
    () => pageState.setPage(0),
    [outcomeFilter, searchQuery, surfaceFilter],
  );
  useEffect(() => {
    if (data?.run.status !== 'running') {
      return;
    }
    const timer = setInterval(refetch, 10_000);
    return () => clearInterval(timer);
  }, [data?.run.status, refetch]);

  const rescore = () => {
    void act(async () => {
      const response = await api<{ rescored: number }>(`/runs/${id}/rescore`, {
        method: 'POST',
        body: '{}',
      });
      toast(`rescored ${response.rescored} results`);
      refetch();
    });
  };

  const mentioned = rows.filter((row) => row.brandMentioned).length;
  const cited = rows.filter((row) => row.brandCited).length;
  const run = data?.run;
  const runRate = run?.totalCount ? run.okCount / run.totalCount : null;
  const resultSummary = loading
    ? 'loading'
    : hasFilters
      ? `${search.items.length} of ${rows.length}`
      : `${rows.length} results`;

  const resizer = (key: string, label: string) => (
    <ColResizer
      label={label}
      onStart={(clientX) => columns.startResize(key, clientX)}
      onNudge={(direction) => columns.nudge(key, direction)}
      onReset={columns.reset}
    />
  );

  return (
    <>
      <PageHeader
        title={run ? `Run ${run.date}` : 'Run detail'}
        description={
          run
            ? `Run #${run.id} · ${triggerLabel(run.trigger)} collection`
            : 'Inspecting collection results.'
        }
        actions={
          <>
            <Link to="/runs" className="btn-secondary">
              <DitherIcon name="arrow-left" size={12} />
              back to runs
            </Link>
            <Tooltip
              asChild
              content={
                run?.status === 'running'
                  ? 'Wait for the run to finish before rescoring'
                  : 'Replay stored raw answers through the current scorer'
              }
              className="border-border-strong bg-bg-elevated text-primary shadow-lg"
            >
              <button
                type="button"
                onClick={rescore}
                disabled={busy || !run || run.status === 'running'}
                className="btn-secondary"
              >
                {busy ? 'rescoring…' : 'rescore'}
              </button>
            </Tooltip>
          </>
        }
      />

      {error && data ? (
        <div
          role="alert"
          className="mb-4 flex items-center justify-between gap-4 border border-error/30 bg-error/5 px-4 py-3"
        >
          <p className="text-[13px] text-error">{error}</p>
          <button type="button" className="btn-secondary" onClick={refetch}>
            retry
          </button>
        </div>
      ) : null}
      {rescoreError ? (
        <p
          role="alert"
          className="mb-4 border border-error/30 bg-error/5 px-4 py-3 text-[13px] text-error"
        >
          {rescoreError}
        </p>
      ) : null}

      {!loading && !data ? (
        <EmptyState
          title="run unavailable"
          hint={error ?? 'This run could not be loaded.'}
          action={
            <Link to="/runs" className="btn-secondary">
              return to runs
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          <section
            aria-labelledby="run-detail-snapshot"
            aria-busy={loading}
            className="overflow-hidden border border-border"
          >
            <header className="flex min-h-10 items-center border-border border-b bg-bg-elevated px-5 py-2.5">
              <h2
                id="run-detail-snapshot"
                className="section-label text-primary"
              >
                Run summary
              </h2>
            </header>
            {loading && !data ? (
              <div className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2 xl:grid-cols-4">
                {[0, 1, 2, 3].map((index) => (
                  <Skeleton
                    key={index}
                    className="min-h-[124px] bg-bg-elevated"
                  />
                ))}
              </div>
            ) : run ? (
              <div className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2 xl:grid-cols-4">
                <StatTile
                  label="Status"
                  value={run.status}
                  spark={
                    <p className="font-mono text-[11px] text-muted">
                      {triggerLabel(run.trigger)} trigger
                    </p>
                  }
                  className={TILE_CLASS}
                />
                <StatTile
                  label="Successful units"
                  value={pct(runRate)}
                  spark={
                    <p className="font-mono text-[11px] text-muted">
                      {run.okCount}/{run.totalCount} completed
                    </p>
                  }
                  className={TILE_CLASS}
                />
                <StatTile
                  label="Brand signals"
                  value={String(mentioned)}
                  spark={
                    <p className="font-mono text-[11px] text-muted">
                      mentioned · {cited} cited
                    </p>
                  }
                  className={TILE_CLASS}
                />
                <StatTile
                  label="Duration"
                  value={durationLabel(runDuration(run))}
                  spark={
                    <p className="font-mono text-[11px] text-muted">
                      started {timestamp(run.createdAt)} UTC
                    </p>
                  }
                  className={TILE_CLASS}
                />
              </div>
            ) : null}
          </section>

          <Card className="overflow-hidden p-0">
            <div className="flex flex-col gap-3 border-border border-b px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <div className="flex items-baseline gap-3">
                  <span className="section-label">prompt results</span>
                  <span
                    className="font-mono text-[10px] text-muted uppercase tracking-[0.08em]"
                    aria-live="polite"
                  >
                    {resultSummary}
                  </span>
                </div>
                <p className="mt-1 text-[12px] text-muted">
                  One row per collected prompt and AI surface in this run.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center xl:justify-end">
                <div className="relative sm:w-64">
                  <input
                    type="search"
                    aria-label="Search run prompts"
                    aria-busy={search.isPending}
                    className="input h-8 w-full appearance-none pr-8 font-mono text-[11px] [&::-webkit-search-cancel-button]:appearance-none"
                    placeholder="search prompts"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                  />
                  {searchQuery ? (
                    <button
                      type="button"
                      aria-label="Clear result search"
                      className="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-muted transition-colors hover:text-primary"
                      onClick={() => setSearchQuery('')}
                    >
                      <DitherIcon name="close" size={12} />
                    </button>
                  ) : null}
                </div>
                <Select
                  value={surfaceFilter}
                  options={surfaces}
                  onChange={setSurfaceFilter}
                  ariaLabel="Filter results by AI surface"
                  size="sm"
                  className="sm:w-40"
                />
                <Select
                  value={outcomeFilter}
                  options={RESULT_OUTCOME_OPTIONS}
                  onChange={setOutcomeFilter}
                  ariaLabel="Filter results by outcome"
                  size="sm"
                  className="sm:w-40"
                />
                <button
                  type="button"
                  className="btn-ghost h-8 px-2 font-mono text-[11px]"
                  onClick={resetTable}
                >
                  reset
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table
                ref={columns.tableRef}
                className="w-full min-w-[1040px] table-fixed border-collapse text-[13px]"
                aria-busy={loading || search.isPending}
              >
                <caption className="sr-only">
                  Prompt results captured in this collection run.
                </caption>
                <ColGroup columns={RESULT_COLUMNS} widths={columns.widths} />
                <thead className="sticky top-12 z-10 lg:top-0">
                  <tr className="bg-bg-elevated shadow-[0_1px_0_var(--color-border)]">
                    <Th
                      label="Prompt"
                      sortKey="prompt"
                      sort={sort}
                      onToggle={toggle}
                      className="px-4"
                      resizer={resizer('prompt', 'prompt')}
                    />
                    <Th
                      label="Surface"
                      sortKey="surface"
                      sort={sort}
                      onToggle={toggle}
                      resizer={resizer('surface', 'surface')}
                    />
                    <Th
                      label="Outcome"
                      sortKey="status"
                      sort={sort}
                      onToggle={toggle}
                      resizer={resizer('status', 'outcome')}
                    />
                    <Th
                      label="Brand"
                      sortKey="brand"
                      sort={sort}
                      onToggle={toggle}
                      resizer={resizer('brand', 'brand')}
                    />
                    <Th
                      label="Sentiment"
                      sortKey="sentiment"
                      sort={sort}
                      onToggle={toggle}
                      resizer={resizer('sentiment', 'sentiment')}
                    />
                    <Th
                      label="URLs"
                      sortKey="urls"
                      sort={sort}
                      onToggle={toggle}
                      align="right"
                      resizer={resizer('urls', 'URLs')}
                    />
                    <Th
                      label="Duration"
                      sortKey="duration"
                      sort={sort}
                      onToggle={toggle}
                      align="right"
                      resizer={resizer('duration', 'duration')}
                    />
                    <Th
                      label="Raw"
                      sortKey="raw"
                      sort={sort}
                      onToggle={toggle}
                      align="right"
                      className="px-4"
                    />
                  </tr>
                </thead>
                <tbody>
                  {loading && !data ? (
                    <TableSkeleton columns={RESULT_COLUMNS} rows={8} />
                  ) : pageState.view.length === 0 ? (
                    <TableEmptyRow
                      colSpan={RESULT_COLUMNS.length}
                      title={
                        hasFilters ? 'no matching results' : 'no results yet'
                      }
                      hint={
                        hasFilters
                          ? 'Try another prompt, surface, or outcome filter.'
                          : 'Results appear here as collection units complete.'
                      }
                      action={
                        hasFilters ? (
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={clearFilters}
                          >
                            clear filters
                          </button>
                        ) : null
                      }
                    />
                  ) : (
                    pageState.view.map((row) => (
                      <tr
                        key={row.id}
                        {...rowActivation(() => setSelectedId(row.id))}
                        className="cursor-pointer border-border border-t transition-colors hover:bg-bg-card-hover focus-visible:bg-bg-card-hover focus-visible:shadow-[inset_2px_0_0_var(--color-primary)]"
                        aria-label={`Open ${surfaceLabel(row.surface)} result for ${row.promptText}`}
                      >
                        <td className="px-4 py-2.5 text-primary">
                          <OverflowTooltip
                            content={row.promptText}
                            delay={400}
                            className="max-w-[min(32rem,calc(100vw-1.5rem))] whitespace-normal border-border-strong bg-bg-elevated text-primary shadow-lg"
                          >
                            <span className="block truncate">
                              {row.promptText}
                            </span>
                          </OverflowTooltip>
                        </td>
                        <td className="px-2 py-2.5 text-secondary">
                          <span className="flex items-center gap-2 truncate">
                            <SurfaceLogo
                              surface={row.surface}
                              className="size-3.5 shrink-0"
                            />
                            <span className="truncate">
                              {surfaceLabel(row.surface)}
                            </span>
                          </span>
                        </td>
                        <td className="px-2 py-2.5">
                          <ResultStatus row={row} />
                        </td>
                        <td className="px-2 py-2.5">
                          <span className="inline-flex gap-1">
                            {row.brandMentioned ? (
                              <Badge tone="ok">mentioned</Badge>
                            ) : null}
                            {row.brandCited ? (
                              <Badge tone="info">cited</Badge>
                            ) : null}
                            {!row.brandMentioned &&
                            !row.brandCited &&
                            row.ok ? (
                              <Badge tone="neutral">—</Badge>
                            ) : null}
                          </span>
                        </td>
                        <td className="px-2 py-2.5">
                          {row.brandSentiment ? (
                            <SentimentTag sentiment={row.brandSentiment} />
                          ) : row.brandMentioned ? (
                            <Tooltip
                              asChild
                              content="sentiment not yet classified"
                              className="border-border-strong bg-bg-elevated text-primary shadow-lg"
                            >
                              <span className="font-mono text-[11px] text-muted">
                                —
                              </span>
                            </Tooltip>
                          ) : null}
                        </td>
                        <td className="px-2 py-2.5 text-right font-mono text-[11px] tabular-nums">
                          {row.totalUrls}
                        </td>
                        <td className="px-2 py-2.5 text-right font-mono text-[11px] text-secondary tabular-nums">
                          {durationLabel(row.durationMs)}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {row.hasRaw ? (
                            <a
                              href={apiPath(
                                `/runs/${id}/results/${row.id}/raw`,
                              )}
                              target="_blank"
                              rel="noreferrer"
                              className="font-mono text-[11px] text-secondary transition-colors hover:text-primary"
                              onClick={(event) => event.stopPropagation()}
                              onKeyDown={(event) => event.stopPropagation()}
                            >
                              view ↗
                            </a>
                          ) : (
                            <span className="font-mono text-[11px] text-muted">
                              —
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <Pagination state={pageState} />
          </Card>
        </div>
      )}

      {selectedId !== null && id ? (
        <ResultPane
          runId={id}
          resultId={selectedId}
          onClose={() => setSelectedId(null)}
        />
      ) : null}
    </>
  );
};
