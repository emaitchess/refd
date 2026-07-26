import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Select } from '@/components/controls/Select';
import { DitherIcon } from '@/components/dither/DitherIcon';
import { Bar } from '@/components/dither-kit/bar';
import { BarChart } from '@/components/dither-kit/bar-chart';
import { DitherGradient } from '@/components/dither-kit/gradient';
import { Grid } from '@/components/dither-kit/grid';
import { Legend } from '@/components/dither-kit/legend';
import { ChartTooltip } from '@/components/dither-kit/tooltip';
import { XAxis } from '@/components/dither-kit/x-axis';
import { YAxis } from '@/components/dither-kit/y-axis';
import { Dots } from '@/components/feedback/Dots';
import { PromptPane } from '@/components/panes/PromptPane';
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
  ChartCard,
  EmptyState,
  MetricInfo,
  OverflowTooltip,
  PromptCategoryTag,
  positiveShare,
  SectionLabel,
  SentimentDistTag,
} from '@/components/ui';
import { useQuery } from '@/lib/api';
import { seriesColor } from '@/lib/chart-colors';
import { pct, position, SURFACE_ORDER, surfaceLabel } from '@/lib/format';
import { METRIC_INFO } from '@/lib/metric-copy';
import type { OnboardingFlow } from '@/lib/onboarding';
import { promptCategory as categoryFromTags } from '@/lib/prompt-categories';
import { SIGN_IN_PATH } from '@/lib/routes';
import { useTheme } from '@/lib/theme';
import type {
  CompetitorsResponse,
  OnboardingState,
  OverviewResponse,
  PromptRow,
  RunRow,
  SentimentDist,
} from '@/lib/types';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth';
import type { SiteMetadata } from '../../../shared/site-metadata';
import { AccountMenu } from './AccountMenu';
import { BrandMark } from './BrandMark';
import {
  OnboardingDashboardReturn,
  OnboardingWorkspaceMenu,
} from './OnboardingWorkspaceNav';

const pct1 = (v: number) => Math.round(v * 1000) / 10;
const MAX_POLLS = 150; // ~12 min at 5s
const ALL_PROMPT_CATEGORIES = 'All categories';

// Prompt text takes the slack; the metric columns only need room for a number.
// Fractions sum to 1 and are the shipped default, so the layout doesn't drift
// with whatever prompt lengths happened to load first.
const PROMPT_COLUMNS: ColumnSpec[] = [
  { key: 'text', min: 160, fraction: 0.52 },
  { key: 'category', min: 90, fraction: 0.1 },
  { key: 'ok', min: 72, fraction: 0.09 },
  { key: 'mention', min: 88, fraction: 0.1 },
  { key: 'cite', min: 72, fraction: 0.09 },
  { key: 'sentiment', min: 96, fraction: 0.1 },
];
const PROMPT_LABELS: Record<string, string> = {
  text: 'Prompt',
  category: 'Category',
  ok: 'Answers',
  mention: 'Mentioned',
  cite: 'Cited',
  sentiment: 'Sentiment',
};

const PROMPT_SORTS: SortAccessors<PromptResultRow> = {
  text: (r) => r.text,
  category: (r) => r.category,
  ok: (r) => r.ok,
  mention: (r) => (r.ok === 0 ? null : r.mention),
  cite: (r) => (r.ok === 0 ? null : r.cite),
  sentiment: (r) => positiveShare(r.sentiment),
};

interface PromptResultRow {
  id: number;
  text: string;
  category: string;
  ok: number;
  mention: number;
  cite: number;
  sentiment: SentimentDist;
  // The source row, handed to the detail pane on click.
  source: PromptRow;
}

const BrandSitePreview = ({
  name,
  domain,
  metadata,
  loading,
}: {
  name: string;
  domain?: string;
  metadata: SiteMetadata | null;
  loading: boolean;
}) => {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => setImageFailed(false), [metadata?.imageUrl]);

  return (
    <div className="w-full min-w-0">
      <BrandMark name={name} domain={domain} />
      {loading ? (
        <div
          role="status"
          className="mt-6 border border-border bg-bg-card px-4 py-3 font-mono text-[10px] text-muted uppercase tracking-widest"
        >
          fetching homepage metadata
          <Dots />
        </div>
      ) : metadata ? (
        <div className="mt-6 overflow-hidden border border-border bg-bg-card">
          {metadata.imageUrl && !imageFailed ? (
            <img
              src={`/api/image?url=${encodeURIComponent(metadata.imageUrl)}`}
              alt={`${name || 'Brand'} homepage preview`}
              className="aspect-[1.91/1] w-full border-border border-b object-cover"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={() => setImageFailed(true)}
            />
          ) : null}
          <div className="p-4">
            <p className="section-label">homepage metadata</p>
            {metadata.title ? (
              <p className="mt-2 text-balance font-[550] text-[14px] text-primary leading-snug">
                {metadata.title}
              </p>
            ) : null}
            {metadata.description ? (
              <p className="mt-2 line-clamp-3 text-[12px] text-secondary leading-relaxed">
                {metadata.description}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
};

// The live "AI Visibility Report" after commit. It polls the onboard runs and
// shows, clearly, what's happening: overall progress, then the single-run charts
// (tiles + per-engine + you-vs-competitors), then a prompt-by-prompt results
// table that fills in as answers stream back.
export const OnboardingReport = ({
  flow,
  state,
}: {
  flow: OnboardingFlow;
  state: OnboardingState;
}) => {
  const overviewQ = useQuery<OverviewResponse>('/overview?range=all');
  const competitorsQ = useQuery<CompetitorsResponse>('/competitors?range=all');
  const runsQ = useQuery<{ runs: RunRow[] }>('/runs?range=all');
  const promptsQ = useQuery<{ prompts: PromptRow[] }>('/prompts?range=all');
  const metadataQ = useQuery<{ metadata: SiteMetadata | null }>(
    state.brand?.domains[0] && !state.profile.siteMetadata
      ? '/onboarding/site-metadata'
      : null,
  );
  const siteMetadata =
    state.profile.siteMetadata ?? metadataQ.data?.metadata ?? null;
  const [promptCategory, setPromptCategory] = useState(ALL_PROMPT_CATEGORIES);

  // Progress spans both onboard runs (preliminary + background).
  const onboardRuns =
    runsQ.data?.runs.filter((r) => r.trigger === 'onboard') ?? [];
  const prelim = onboardRuns.find((r) => !r.key.startsWith('onboard-bg'));
  const okCount = onboardRuns.reduce((s, r) => s + r.okCount, 0);
  const totalCount = onboardRuns.reduce((s, r) => s + r.totalCount, 0);
  const prelimDone = prelim ? prelim.status !== 'running' : false;
  const failed = prelim?.status === 'failed';
  const allDone =
    onboardRuns.length > 0 && onboardRuns.every((r) => r.status !== 'running');
  const progressPct =
    totalCount > 0 ? Math.round((okCount / totalCount) * 100) : 0;

  const polls = useRef(0);
  // Giving up has to be visible: without this the panel would sit on a stale
  // progress bar forever, looking identical to a run that is still working.
  const [gaveUp, setGaveUp] = useState(false);

  const refetchAll = useCallback(() => {
    overviewQ.refetch();
    competitorsQ.refetch();
    runsQ.refetch();
    promptsQ.refetch();
  }, [
    overviewQ.refetch,
    competitorsQ.refetch,
    runsQ.refetch,
    promptsQ.refetch,
  ]);

  // Sentiment classification trails each answer by a queue hop, so keep
  // polling a couple of grace cycles after the last answer lands.
  const GRACE_POLLS = 2;
  const [gracePolls, setGracePolls] = useState(0);
  const settled = allDone && gracePolls >= GRACE_POLLS;

  const keepWatching = useCallback(() => {
    polls.current = 0;
    setGaveUp(false);
    setGracePolls(0);
    refetchAll();
  }, [refetchAll]);

  // Poll until every onboard run finishes (or a safety cap) so the report fills live.
  useEffect(() => {
    if (settled || gaveUp) {
      return;
    }
    const id = setInterval(() => {
      polls.current += 1;
      if (polls.current > MAX_POLLS) {
        clearInterval(id);
        setGaveUp(true);
        return;
      }
      if (allDone) {
        setGracePolls((n) => n + 1);
      }
      refetchAll();
    }, 5000);
    return () => clearInterval(id);
  }, [allDone, settled, gaveUp, refetchAll]);

  const surfaceRows = useMemo(
    () =>
      [...(overviewQ.data?.surfaces ?? [])]
        .sort(
          (a, b) =>
            SURFACE_ORDER.indexOf(a.surface) - SURFACE_ORDER.indexOf(b.surface),
        )
        .map((s) => ({
          surface: surfaceLabel(s.surface),
          mentionRate: pct1(s.mentionRate ?? 0),
          citationRate: pct1(s.citationRate ?? 0),
        })),
    [overviewQ.data],
  );

  // One series per entity, not one series over entity-named categories: a bar's
  // colour comes from its series, so a single series paints every competitor in
  // the brand's green. Keyed by name with seriesColor(sortOrder) — the same
  // mapping behind EntityChip and every dashboard chart, so green is always us.
  const competitors = useMemo(() => {
    const ordered = [...(competitorsQ.data?.entities ?? [])].sort(
      (a, b) => a.sortOrder - b.sortOrder,
    );
    return {
      config: Object.fromEntries(
        ordered.map((e, i) => [
          e.name,
          { label: e.name, color: seriesColor(i) },
        ]),
      ),
      // A single group: this is one run, so there is one bar per entity.
      rows: [
        {
          group: 'all surfaces',
          ...Object.fromEntries(
            ordered.map((e) => [e.name, pct1(e.mentionRate ?? 0)]),
          ),
        },
      ],
      names: ordered.map((e) => e.name),
    };
  }, [competitorsQ.data]);

  const sentimentRows = useMemo(() => {
    const dist = overviewQ.data?.sentiment;
    if (!dist) {
      return [];
    }
    const total = dist.positive + dist.neutral + dist.negative;
    if (total === 0) {
      return [];
    }
    return [
      { stance: 'positive', share: pct1(dist.positive / total) },
      { stance: 'neutral', share: pct1(dist.neutral / total) },
      { stance: 'negative', share: pct1(dist.negative / total) },
    ];
  }, [overviewQ.data]);

  // Per-prompt rollup across surfaces (weighted by ok results).
  const promptRows = useMemo(
    () =>
      (promptsQ.data?.prompts ?? []).map((p) => {
        const ok = p.surfaces.reduce((s, x) => s + x.answers, 0);
        const weighted = (key: 'mentionRate' | 'citationRate') =>
          ok === 0
            ? 0
            : p.surfaces.reduce((s, x) => s + (x[key] ?? 0) * x.answers, 0) /
              ok;
        return {
          id: p.id,
          text: p.text,
          category: categoryFromTags(p.tags),
          ok,
          mention: weighted('mentionRate'),
          cite: weighted('citationRate'),
          sentiment: p.sentiment,
          source: p,
        };
      }),
    [promptsQ.data],
  );
  const answered = promptRows.filter((r) => r.ok > 0).length;
  const promptCategoryOptions = useMemo(
    () => [
      ALL_PROMPT_CATEGORIES,
      ...new Set(promptRows.map((row) => row.category)),
    ],
    [promptRows],
  );
  const activePromptCategory = promptCategoryOptions.includes(promptCategory)
    ? promptCategory
    : ALL_PROMPT_CATEGORIES;
  const filteredPromptRows = useMemo(
    () =>
      activePromptCategory === ALL_PROMPT_CATEGORIES
        ? promptRows
        : promptRows.filter((row) => row.category === activePromptCategory),
    [activePromptCategory, promptRows],
  );
  const filteredAnswered = filteredPromptRows.filter((r) => r.ok > 0).length;

  // Default to prompt order (A-Z): the table fills in live, and sorting by a
  // metric would reshuffle rows under the reader on every poll.
  const sorted = useSort(filteredPromptRows, PROMPT_SORTS, {
    key: 'text',
    dir: 'asc',
  });
  const page = usePagination(sorted.sorted, 10);
  const cols = useColumnWidths('onboard-prompts', PROMPT_COLUMNS);
  const [selected, setSelected] = useState<PromptRow | null>(null);

  useEffect(() => {
    page.setPage(0);
  }, [activePromptCategory, page.setPage]);

  const { email, logout } = useAuth();
  const navigate = useNavigate();
  const [theme, toggleTheme] = useTheme();
  const signOut = async () => {
    await logout();
    navigate(SIGN_IN_PATH, { replace: true });
  };

  const tiles = overviewQ.data?.tiles.current ?? null;
  const surfaceCount = state.surfaces.length;

  // "Waiting" and "there is nothing" look identical if the copy never changes.
  const emptyChart = allDone
    ? {
        title: 'no data',
        hint: 'No answers scored for these prompts.',
        className: 'min-h-64',
      }
    : {
        title: 'waiting for answers',
        hint: 'This fills in as results come back.',
        className: 'min-h-64',
      };

  // "Positive sentiment" is a pure share (positive ÷ classified mentions),
  // not an "average" — sentiment is categorical, and averaging it would
  // manufacture the composite score the metrics principles rule out.
  const reportTiles = [
    {
      label: 'Mention rate',
      value: pct(tiles?.mentionRate),
      info: METRIC_INFO.mentionRate,
    },
    {
      label: 'Share of voice',
      value: pct(tiles?.sov),
      info: METRIC_INFO.shareOfVoice,
    },
    {
      label: 'Avg position',
      value: position(tiles?.avgPosition),
      info: METRIC_INFO.averagePosition,
    },
    {
      label: 'Citation rate',
      value: pct(tiles?.citationRate),
      info: METRIC_INFO.citationRate,
    },
    {
      label: 'Positive sentiment',
      value: pct(positiveShare(overviewQ.data?.sentiment ?? null)),
      info: METRIC_INFO.positiveSentiment,
    },
  ];
  // The single-run extras that fit a line, not a tile.
  const reportNotes = [
    tiles?.firstMentionShare != null
      ? `named first ${pct(tiles.firstMentionShare)} of the time`
      : null,
    overviewQ.data?.coverage?.aio
      ? `AI Overviews appeared on ${pct(
          overviewQ.data.coverage.aio.present /
            overviewQ.data.coverage.aio.total,
        )} of prompts`
      : null,
    tiles?.citationSov != null
      ? `citation SOV ${pct(tiles.citationSov)}`
      : null,
  ].filter((n): n is string => n !== null);

  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-border border-b">
        <div className="mx-auto grid h-14 w-full max-w-[1120px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-border border-x px-3 sm:px-8 md:h-17 md:grid-cols-[1fr_auto_1fr]">
          <div className="flex items-center gap-2.5">
            <DitherIcon name="logo" size={20} className="text-primary" />
            <span className="hidden font-mono text-[15px] text-primary sm:inline">
              refd
            </span>
          </div>
          <div className="flex min-w-0 justify-center">
            <OnboardingWorkspaceMenu disabled={flow.busy} />
          </div>
          <div className="flex items-center justify-end gap-1.5 sm:gap-2">
            <OnboardingDashboardReturn disabled={flow.busy} />
            <button
              type="button"
              className="btn-primary h-8 gap-1.5 px-2 sm:h-9 sm:px-4"
              onClick={flow.enterDashboard}
              disabled={flow.busy}
            >
              <span className="sm:hidden">enter</span>
              <span className="hidden sm:inline">enter dashboard</span>
              <DitherIcon name="arrow-right" size={12} />
            </button>
            {email ? (
              <AccountMenu
                email={email}
                onSignOut={signOut}
                className="hidden size-9 text-[13px] sm:flex"
              />
            ) : null}
          </div>
        </div>
      </header>

      <main className="flex-1 border-border border-b">
        <div className="mx-auto w-full max-w-[1120px] border-border border-x">
          <section className="grid border-border border-b lg:grid-cols-[1.25fr_0.75fr]">
            <div className="px-5 py-14 sm:px-8 sm:py-18 lg:border-border lg:border-r lg:py-20">
              <p className="font-mono text-[10px] text-accent uppercase tracking-[0.16em]">
                monitoring is live
              </p>
              <h1 className="mt-5 max-w-[650px] text-balance font-medium text-[36px] text-primary leading-[1.04] tracking-[-0.04em] sm:text-[48px]">
                {allDone
                  ? 'Your first AI search report is ready.'
                  : 'Your first AI search answers are arriving.'}
              </h1>
              <p className="mt-5 max-w-[620px] text-[14px] text-secondary leading-[1.7] sm:text-[15px]">
                This report fills in as refd checks your prompts. Every metric
                remains connected to the surface, prompt, and raw answer behind
                it.
              </p>
            </div>
            <div className="flex items-center bg-bg-elevated/25 px-5 py-8 sm:px-8 lg:py-12">
              <BrandSitePreview
                name={state.brand?.name ?? ''}
                domain={state.brand?.domains[0]}
                metadata={siteMetadata}
                loading={metadataQ.loading}
              />
            </div>
          </section>

          {flow.error ? (
            <p
              role="alert"
              className="border-error/40 border-b border-l-2 bg-error/5 px-5 py-3 text-[12px] text-error sm:px-8"
            >
              {flow.error}
            </p>
          ) : null}

          <section className="border-border border-b px-5 py-6 sm:px-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="section-label text-primary">
                {allDone
                  ? failed
                    ? 'First check needs attention'
                    : 'First report complete'
                  : gaveUp
                    ? 'Checks still running'
                    : !prelim
                      ? 'Starting your first check'
                      : prelimDone
                        ? 'First results in, finishing the rest'
                        : 'Checking AI answers'}
                {!allDone && !gaveUp ? <Dots /> : null}
              </span>
              <span className="font-mono text-[11px] text-muted">
                {okCount}/{totalCount || '—'} answers · {progressPct}%
              </span>
            </div>
            <div
              role="progressbar"
              aria-label="AI answer checks completed"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressPct}
              className="mt-4 h-1 w-full overflow-hidden bg-bg-subtle"
            >
              <div
                className="h-full bg-accent transition-[width] duration-700"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="mt-4 text-[12px] text-secondary leading-[1.65]">
              {allDone ? (
                failed ? (
                  'The first check ran into trouble. You can retry from the dashboard.'
                ) : (
                  `All runs complete: ${answered} of ${promptRows.length} prompts answered.`
                )
              ) : gaveUp ? (
                <span className="flex flex-wrap items-center gap-2">
                  We stopped watching for updates, but your checks may still be
                  running.
                  <button
                    type="button"
                    className="btn-ghost h-6 px-1 text-[12px] underline underline-offset-2"
                    onClick={keepWatching}
                  >
                    check again
                  </button>
                </span>
              ) : (
                `Running your prompts across ${surfaceCount} surface${surfaceCount === 1 ? '' : 's'}. You can enter the dashboard while the remaining answers arrive.`
              )}
            </div>
          </section>

          <section className="border-border border-b">
            <div className="border-border border-b px-5 py-3 sm:px-8">
              <SectionLabel>report summary</SectionLabel>
            </div>
            {/* gap-px over bg-border draws the hairlines for any tile count;
                the last tile spans the odd mobile row so no empty cell shows
                through. */}
            <div className="grid grid-cols-2 gap-px bg-border md:grid-cols-5">
              {reportTiles.map((tile, index) => (
                <div
                  key={tile.label}
                  className={cn(
                    'min-w-0 bg-bg px-5 py-5 sm:px-6',
                    index === reportTiles.length - 1 &&
                      reportTiles.length % 2 === 1 &&
                      'col-span-2 md:col-span-1',
                  )}
                >
                  <p className="flex items-center gap-0.5 font-mono text-[10px] text-muted uppercase tracking-[0.12em]">
                    {tile.label}
                    <MetricInfo
                      label={tile.label.toLowerCase()}
                      metric={tile.info}
                      glossaryLink={false}
                    />
                  </p>
                  <p className="mt-3 font-mono text-[28px] text-primary leading-none">
                    {tile.value}
                  </p>
                </div>
              ))}
            </div>
            {reportNotes.length > 0 ? (
              <p className="border-border border-t px-5 py-3 font-mono text-[11px] text-muted sm:px-6">
                {reportNotes.join(' · ')}
              </p>
            ) : null}
          </section>

          <section className="grid border-border border-b lg:grid-cols-2">
            <ChartCard
              title="brand mention rate % · by surface"
              className="h-full border-0 border-border border-b lg:border-r lg:border-b-0"
            >
              {surfaceRows.length > 0 ? (
                <BarChart
                  data={surfaceRows}
                  config={{
                    mentionRate: {
                      label: 'mention rate',
                      color: seriesColor(0),
                    },
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
                <EmptyState {...emptyChart} />
              )}
            </ChartCard>

            <ChartCard
              title="mentioned vs cited % · by surface"
              className="h-full border-0"
            >
              {surfaceRows.length > 0 ? (
                <BarChart
                  data={surfaceRows}
                  config={{
                    mentionRate: { label: 'mentioned', color: 'green' },
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
                <EmptyState {...emptyChart} />
              )}
            </ChartCard>

            <ChartCard
              title="mention rate % · you vs competitors"
              className="h-full border-0 border-border border-t lg:border-r"
            >
              {competitors.names.length > 0 ? (
                <BarChart
                  data={competitors.rows}
                  config={competitors.config}
                  margins={{ top: 32 }}
                  className="h-64 w-full"
                >
                  <Grid />
                  <XAxis dataKey="group" />
                  <YAxis tickFormatter={(v) => `${Math.round(v)}%`} />
                  {competitors.names.map((name) => (
                    <Bar key={name} dataKey={name} />
                  ))}
                  <Legend />
                  <ChartTooltip />
                </BarChart>
              ) : (
                <EmptyState {...emptyChart} />
              )}
            </ChartCard>

            <ChartCard
              title="brand sentiment · % of classified mentions"
              className="h-full border-0 border-border border-t"
            >
              {sentimentRows.length > 0 ? (
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
                  title={
                    settled ? 'no classified mentions' : 'waiting for mentions'
                  }
                  hint={
                    settled
                      ? 'The brand was not mentioned in these answers, so there is nothing to classify.'
                      : 'Sentiment appears shortly after an answer mentioning the brand is scored.'
                  }
                  className="min-h-64"
                />
              )}
            </ChartCard>
          </section>

          <section>
            <div className="flex flex-wrap items-center justify-between gap-3 border-border border-b px-4 py-3">
              <SectionLabel>prompt results</SectionLabel>
              <div className="flex items-center gap-3">
                <Select
                  value={activePromptCategory}
                  options={promptCategoryOptions}
                  onChange={setPromptCategory}
                  ariaLabel="Filter prompt results by category"
                  size="sm"
                  className="w-40 sm:w-44"
                  renderOption={(option) =>
                    option === ALL_PROMPT_CATEGORIES ? (
                      option
                    ) : (
                      <PromptCategoryTag category={option} />
                    )
                  }
                />
                <span className="whitespace-nowrap font-mono text-[11px] text-muted">
                  {filteredAnswered}/{filteredPromptRows.length} answered
                </span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table
                ref={cols.tableRef}
                className={cn(
                  'w-full border-collapse text-[13px]',
                  cols.widths && 'table-fixed',
                )}
              >
                <ColGroup columns={PROMPT_COLUMNS} widths={cols.widths} />
                <thead>
                  <tr className="bg-bg-elevated">
                    {PROMPT_COLUMNS.map((col, i) => (
                      <Th
                        key={col.key}
                        label={PROMPT_LABELS[col.key] ?? col.key}
                        sortKey={col.key}
                        sort={sorted.sort}
                        onToggle={sorted.toggle}
                        align={
                          col.key === 'text' || col.key === 'category'
                            ? 'left'
                            : 'right'
                        }
                        className={i === 0 ? 'px-4' : undefined}
                        resizer={
                          i < PROMPT_COLUMNS.length - 1 ? (
                            <ColResizer
                              label={PROMPT_LABELS[col.key] ?? col.key}
                              onStart={(x) => cols.startResize(col.key, x)}
                              onNudge={(d) => cols.nudge(col.key, d)}
                              onReset={cols.reset}
                            />
                          ) : undefined
                        }
                      />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {page.view.map((r) => (
                    <tr
                      key={r.id}
                      {...rowActivation(() => setSelected(r.source))}
                      className="cursor-pointer border-border border-t transition-colors hover:bg-bg-card-hover focus-visible:bg-bg-card-hover"
                    >
                      <td className="max-w-0 px-4 py-2">
                        <OverflowTooltip
                          content={r.text}
                          delay={400}
                          className="max-w-[min(32rem,calc(100vw-1.5rem))] whitespace-normal border-border-strong bg-bg-elevated text-primary shadow-lg"
                        >
                          <span className="block truncate text-primary">
                            {r.text}
                          </span>
                        </OverflowTooltip>
                      </td>
                      <td className="truncate px-2 py-2">
                        <PromptCategoryTag category={r.category} />
                      </td>
                      {r.ok > 0 ? (
                        <>
                          <td className="px-2 py-2 text-right font-mono">
                            {r.ok}
                          </td>
                          <td className="px-2 py-2 text-right font-mono">
                            {pct(r.mention)}
                          </td>
                          <td className="px-2 py-2 text-right font-mono">
                            {pct(r.cite)}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <SentimentDistTag dist={r.sentiment} />
                          </td>
                        </>
                      ) : (
                        <td colSpan={4} className="px-4 py-2 text-right">
                          <span className="font-mono text-[11px] text-muted">
                            {allDone ? (
                              'no answer'
                            ) : (
                              <>
                                pending
                                <Dots />
                              </>
                            )}
                          </span>
                        </td>
                      )}
                    </tr>
                  ))}
                  {filteredPromptRows.length === 0 ? (
                    <tr className="border-border border-t">
                      <td
                        colSpan={PROMPT_COLUMNS.length}
                        className="px-4 py-6 text-center text-[12px] text-muted"
                      >
                        {/* Saying "loading" after the fetch resolved is a lie the user
                      can wait on forever. */}
                        {promptsQ.loading
                          ? 'loading prompts…'
                          : promptRows.length === 0
                            ? 'no prompts yet'
                            : 'no prompts in this category'}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <Pagination state={page} />
          </section>
        </div>
      </main>

      <footer className="border-border border-b">
        <div className="relative mx-auto flex min-h-16 w-full max-w-[1120px] items-center justify-between overflow-hidden border-border border-x px-5 sm:px-8">
          <DitherGradient
            from="red"
            to="transparent"
            direction="up"
            cell={3}
            opacity={theme === 'dark' ? 0.055 : 0.025}
            bloom="off"
          />
          <span className="relative z-1 font-mono text-[10px] text-muted uppercase tracking-[0.12em]">
            first report · live results
          </span>
          <button
            type="button"
            onClick={toggleTheme}
            className="relative z-1 flex h-8 items-center gap-2 text-[11px] text-secondary transition-colors hover:text-primary"
          >
            <DitherIcon name={theme === 'dark' ? 'sun' : 'moon'} size={13} />
          </button>
        </div>
      </footer>

      {selected ? (
        <PromptPane prompt={selected} onClose={() => setSelected(null)} />
      ) : null}
    </div>
  );
};
