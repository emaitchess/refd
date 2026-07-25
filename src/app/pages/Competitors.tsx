import type { IFuseOptions } from 'fuse.js';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { AliasesCard } from '@/components/competitors/AliasesCard';
import { RangePicker, useRange } from '@/components/controls/RangePicker';
import { Select } from '@/components/controls/Select';
import { DitherIcon } from '@/components/dither/DitherIcon';
import { Legend } from '@/components/dither-kit/legend';
import { Radar } from '@/components/dither-kit/radar';
import { RadarChart } from '@/components/dither-kit/radar-chart';
import { RadarFrame } from '@/components/dither-kit/radar-frame';
import { Tooltip } from '@/components/dither-kit/tooltip';
import { PageHeader } from '@/components/layout/PageHeader';
import {
  ColGroup,
  ColResizer,
  type ColumnSpec,
  Pagination,
  type SortAccessors,
  Th,
  useColumnWidths,
  usePagination,
  useSort,
} from '@/components/table/table';
import {
  Badge,
  Card,
  ChartCard,
  EmptyState,
  EntityChip,
  Favicon,
  MetricInfo,
  Modal,
  positiveShare,
  RowMenu,
  Skeleton,
  StatTile,
  sentimentSplit,
} from '@/components/ui';
import {
  type UseFuzzySearchOptions,
  useFuzzySearch,
} from '@/hooks/useFuzzySearch';
import { api, useAsyncAction, useQuery } from '@/lib/api';
import { seriesColor } from '@/lib/chart-colors';
import { pct, position, SURFACE_ORDER, surfaceLabel } from '@/lib/format';
import { useOnKeyPress } from '@/lib/keyboard';
import { METRIC_INFO } from '@/lib/metric-copy';
import { useParamFlag } from '@/lib/params';
import type {
  CompetitorEntity,
  CompetitorsResponse,
  EntityAlias,
} from '@/lib/types';
import { cn, domainFromUrl, handleDomainPaste } from '@/lib/utils';

const RADAR_SERIES = 4;
const ALL_ENTITIES = 'all entities';
const COMPETITORS_ONLY = 'competitors only';
const ENTITY_FILTER_OPTIONS = [ALL_ENTITIES, COMPETITORS_ONLY];
const TILE_CLASS = 'min-h-[124px] border-0 bg-bg-elevated';

const SORTS: SortAccessors<CompetitorEntity> = {
  order: (entity) => entity.sortOrder,
  entity: (entity) => entity.name.toLowerCase(),
  domains: (entity) => entity.domains.join(' ').toLowerCase(),
  mention: (entity) => entity.mentionRate,
  sov: (entity) => entity.sov,
  position: (entity) => entity.avgPosition,
  citation: (entity) => entity.citationRate,
  first: (entity) => entity.firstMentionShare,
  sentiment: (entity) => positiveShare(entity.sentiment),
};

const ENTITY_COLUMNS: ColumnSpec[] = [
  { key: 'entity', min: 240, fraction: 0.22 },
  { key: 'domains', min: 150, fraction: 0.14 },
  { key: 'mention', min: 104, fraction: 0.1 },
  { key: 'sov', min: 92, fraction: 0.09 },
  { key: 'position', min: 96, fraction: 0.09 },
  { key: 'citation', min: 112, fraction: 0.11 },
  { key: 'first', min: 104, fraction: 0.09 },
  { key: 'sentiment', min: 104, fraction: 0.1 },
  { key: 'actions', min: 64, fraction: 0.06 },
];

const ENTITY_FUSE_OPTIONS: IFuseOptions<CompetitorEntity> = {
  keys: [
    { name: 'name', weight: 0.72 },
    { name: 'domains', weight: 0.28 },
  ],
  threshold: 0.34,
  ignoreDiacritics: true,
  ignoreLocation: true,
  includeMatches: true,
  includeScore: true,
};
const ENTITY_SEARCH_OPTIONS: UseFuzzySearchOptions<CompetitorEntity> = {
  fuseOptions: ENTITY_FUSE_OPTIONS,
};

interface SurfaceLeader {
  surface: string;
  entity: CompetitorEntity;
  rate: number;
}

const signedPoints = (value: number | null) => {
  if (value === null) {
    return '—';
  }
  const points = value * 100;
  return `${points > 0 ? '+' : ''}${points.toFixed(1)} pp`;
};

export const Competitors = () => {
  const [range, setRange] = useRange();
  const { data, loading, error, refetch } = useQuery<CompetitorsResponse>(
    `/competitors?range=${range}`,
  );
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CompetitorEntity | null>(null);
  const [removing, setRemoving] = useState<CompetitorEntity | null>(null);
  const [name, setName] = useState('');
  const [domains, setDomains] = useState('');
  const [aliases, setAliases] = useState<EntityAlias[]>([]);
  const [aliasDraft, setAliasDraft] = useState('');
  const [aliasCaseSensitive, setAliasCaseSensitive] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [entityFilter, setEntityFilter] = useState(ALL_ENTITIES);
  const {
    busy,
    error: formError,
    setError: setFormError,
    run,
  } = useAsyncAction();
  const {
    busy: removeBusy,
    error: removeError,
    setError: setRemoveError,
    run: runRemove,
  } = useAsyncAction();

  const closeForm = () => {
    setAdding(false);
    setEditing(null);
    setName('');
    setDomains('');
    setAliases([]);
    setAliasDraft('');
    setAliasCaseSensitive(false);
    setFormError(null);
  };

  const openAdd = () => {
    setEditing(null);
    setName('');
    setDomains('');
    setAliases([]);
    setAliasDraft('');
    setAliasCaseSensitive(false);
    setFormError(null);
    setAdding(true);
  };

  const openEdit = (entity: CompetitorEntity) => {
    setAdding(false);
    setEditing(entity);
    setName(entity.name);
    setDomains(entity.domains.join(', '));
    setAliases(entity.aliases);
    setAliasDraft('');
    setAliasCaseSensitive(false);
    setFormError(null);
  };

  useParamFlag('new', openAdd);
  useOnKeyPress(
    'a',
    () => {
      if (document.querySelector('[role="dialog"]')) {
        return;
      }
      openAdd();
    },
    {
      enabled: !adding && !editing && !removing,
      preventDefault: true,
    },
  );

  const saveCompetitor = (event: FormEvent) => {
    event.preventDefault();
    run(async () => {
      const parsedDomains = Array.from(
        new Set(domains.split(',').map(domainFromUrl).filter(Boolean)),
      );
      const body = JSON.stringify({
        name: name.trim(),
        domains: parsedDomains,
        aliases,
      });
      await (editing
        ? api(`/entities/${editing.id}`, { method: 'PATCH', body })
        : api('/entities', { method: 'POST', body }));
      closeForm();
      refetch();
    });
  };

  const removeCompetitor = () => {
    if (!removing) {
      return;
    }
    runRemove(async () => {
      await api(`/entities/${removing.id}`, {
        method: 'DELETE',
        body: '{}',
      });
      setRemoving(null);
      refetch();
    });
  };

  const addAlias = () => {
    setFormError(null);
    const value = aliasDraft.trim();
    if (!value) {
      return;
    }
    if (aliases.length >= 10) {
      setFormError('a competitor can have at most 10 aliases');
      return;
    }
    const covered = new Set([
      name.trim().toLowerCase(),
      ...aliases.map((alias) => alias.value.toLowerCase()),
    ]);
    if (covered.has(value.toLowerCase())) {
      setFormError(`"${value}" is already matched for ${name.trim()}`);
      return;
    }
    setAliases((current) => [
      ...current,
      aliasCaseSensitive ? { value, caseSensitive: true } : { value },
    ]);
    setAliasDraft('');
  };

  const ordered = useMemo(
    () => [...(data?.entities ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
    [data],
  );
  const brand = ordered.find((entity) => entity.isBrand) ?? null;
  const competitors = ordered.filter((entity) => !entity.isBrand);
  const leadingCompetitor =
    [...competitors].sort((a, b) => (b.sov ?? -1) - (a.sov ?? -1))[0] ?? null;
  const sovGap =
    brand?.sov != null && leadingCompetitor?.sov != null
      ? brand.sov - leadingCompetitor.sov
      : null;
  const sovGapHint = !leadingCompetitor
    ? 'add a competitor to compare'
    : sovGap === null
      ? 'waiting for scored answers'
      : sovGap > 0
        ? `ahead of ${leadingCompetitor.name}`
        : sovGap < 0
          ? `behind ${leadingCompetitor.name}`
          : `level with ${leadingCompetitor.name}`;

  const filteredEntities = useMemo(
    () =>
      entityFilter === COMPETITORS_ONLY
        ? ordered.filter((entity) => !entity.isBrand)
        : ordered,
    [entityFilter, ordered],
  );
  const entitySearch = useFuzzySearch(
    filteredEntities,
    searchQuery,
    ENTITY_SEARCH_OPTIONS,
  );
  const searchRanks = useMemo(
    () =>
      new Map(
        entitySearch.results.map((result, index) => [result.item.id, index]),
      ),
    [entitySearch.results],
  );
  const entitySorts = useMemo<SortAccessors<CompetitorEntity>>(
    () => ({
      ...SORTS,
      relevance: (entity) =>
        entitySearch.hasQuery
          ? (searchRanks.get(entity.id) ?? Number.MAX_SAFE_INTEGER)
          : entity.sortOrder,
    }),
    [entitySearch.hasQuery, searchRanks],
  );
  const { sorted, sort, toggle } = useSort(entitySearch.items, entitySorts, {
    key: 'relevance',
    dir: 'asc',
  });
  const pageState = usePagination(sorted, 25);
  const columns = useColumnWidths('competitors', ENTITY_COLUMNS);

  useEffect(() => {
    pageState.setPage(0);
  }, [entityFilter, pageState.setPage, searchQuery]);

  const radar = useMemo(() => {
    if (!data) {
      return null;
    }
    const shown = [
      ...ordered.filter((entity) => entity.isBrand),
      ...ordered
        .filter((entity) => !entity.isBrand)
        .sort((a, b) => (b.sov ?? 0) - (a.sov ?? 0)),
    ].slice(0, RADAR_SERIES);
    const surfaces = [
      ...new Set(
        shown.flatMap((entity) =>
          entity.surfaces.map((surface) => surface.surface),
        ),
      ),
    ];
    if (surfaces.length < 3) {
      return null;
    }
    const rows = surfaces.map((surface) => {
      const row: Record<string, string | number> = {
        surface: surfaceLabel(surface),
      };
      for (const entity of shown) {
        row[`e${entity.id}`] =
          (entity.surfaces.find((item) => item.surface === surface)
            ?.mentionRate ?? 0) * 100;
      }
      return row;
    });
    const config = Object.fromEntries(
      shown.map((entity) => [
        `e${entity.id}`,
        { label: entity.name, color: seriesColor(ordered.indexOf(entity)) },
      ]),
    );
    return { rows, config };
  }, [data, ordered]);

  const surfaceLeaders = useMemo(() => {
    const surfaces = [
      ...new Set(
        ordered.flatMap((entity) =>
          entity.surfaces.map((surface) => surface.surface),
        ),
      ),
    ].sort((a, b) => {
      const aIndex = SURFACE_ORDER.indexOf(a);
      const bIndex = SURFACE_ORDER.indexOf(b);
      return (
        (aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex) -
        (bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex)
      );
    });
    const leaders: SurfaceLeader[] = [];
    for (const surface of surfaces) {
      let leader: CompetitorEntity | null = null;
      let rate: number | null = null;
      for (const entity of ordered) {
        const value = entity.surfaces.find(
          (item) => item.surface === surface,
        )?.mentionRate;
        if (value != null && (rate === null || value > rate)) {
          leader = entity;
          rate = value;
        }
      }
      if (leader && rate !== null) {
        leaders.push({ surface, entity: leader, rate });
      }
    }
    return leaders;
  }, [ordered]);

  const clearFilters = () => {
    setSearchQuery('');
    setEntityFilter(ALL_ENTITIES);
  };
  const resetTable = () => {
    clearFilters();
    pageState.setPage(0);
    columns.reset();
  };
  const hasFilters =
    searchQuery.trim().length > 0 || entityFilter !== ALL_ENTITIES;
  const resultSummary = loading
    ? data
      ? `${pageState.total} of ${ordered.length} · updating`
      : 'loading entities'
    : entitySearch.isPending
      ? 'searching entities'
      : `${pageState.total} of ${ordered.length}`;

  const resizer = (key: string, label: string) => (
    <ColResizer
      label={label}
      onStart={(clientX) => columns.startResize(key, clientX)}
      onNudge={(direction) => columns.nudge(key, direction)}
      onReset={columns.reset}
    />
  );
  const previewDomain = domainFromUrl(domains.split(',')[0] ?? '');
  const aliasRefreshToken = ordered
    .map(
      (entity) =>
        `${entity.id}:${entity.name}:${entity.domains.join(',')}:${entity.aliases.map((alias) => `${alias.value}:${alias.caseSensitive === true}`).join(',')}:${entity.sortOrder}`,
    )
    .join('|');

  return (
    <>
      <PageHeader
        title="Competitors"
        description="Compare visibility, position, citations, and answer ownership against the brands buyers consider alongside you."
        actions={
          <>
            <RangePicker value={range} onChange={setRange} />
            <button type="button" className="btn-primary" onClick={openAdd}>
              add competitor
              <kbd className="kbd kbd-invert h-4 min-w-4 text-[10px]">a</kbd>
            </button>
          </>
        }
      />

      {adding || editing ? (
        <Modal
          title={editing ? 'Edit competitor' : 'Add competitor'}
          onClose={closeForm}
          panelClassName="max-w-xl"
        >
          <form onSubmit={saveCompetitor} className="flex flex-col gap-4">
            <div className="border border-border">
              <div className="flex min-h-20 items-center gap-3 border-border border-b bg-bg-card px-4 py-3">
                <Favicon domain={previewDomain} size={32} />
                <div className="min-w-0">
                  <div className="section-label">
                    {editing ? 'competitor identity' : 'new tracked entity'}
                  </div>
                  <div className="mt-1 truncate text-[15px] text-primary">
                    {name.trim() || 'Untitled competitor'}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[10px] text-muted">
                    {previewDomain || 'add a domain to preview the identity'}
                  </div>
                </div>
              </div>
              <label className="flex flex-col gap-1.5 px-4 py-3">
                <span className="field-label">Name</span>
                <input
                  className="input"
                  placeholder="competitor name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={100}
                  required
                  autoFocus
                />
              </label>
              <label className="flex flex-col gap-1.5 border-border border-t px-4 py-3">
                <span className="field-label">Domains</span>
                <input
                  className="input"
                  placeholder="comma-separated, e.g. example.com, example.ai"
                  value={domains}
                  onChange={(event) => setDomains(event.target.value)}
                  onPaste={(event) =>
                    handleDomainPaste(event, domains, setDomains, true)
                  }
                  required
                />
                <span className="text-[11px] text-muted">
                  Add every domain that should count as belonging to this
                  competitor.
                </span>
              </label>
              <div className="border-border border-t px-4 py-3">
                <div className="field-label">Aliases</div>
                <p className="mt-1 text-[11px] text-muted">
                  Alternate names that should also count as mentions.
                </p>
                <div className="mt-2 flex min-h-6 flex-wrap items-center gap-1.5">
                  {aliases.map((alias, index) => (
                    <span
                      key={`${alias.value}-${index}`}
                      className="inline-flex h-6 items-center gap-1 border border-border pr-1 pl-2 font-mono text-[11px] text-secondary"
                    >
                      {alias.value}
                      {alias.caseSensitive ? (
                        <Tooltip
                          asChild
                          content="matches case exactly"
                          className="border-border-strong bg-bg-elevated text-primary shadow-lg"
                        >
                          <span className="text-[10px] text-muted">Aa</span>
                        </Tooltip>
                      ) : null}
                      <button
                        type="button"
                        aria-label={`Remove alias ${alias.value}`}
                        className="cursor-pointer px-0.5 text-muted transition-colors hover:text-primary"
                        onClick={() =>
                          setAliases((current) =>
                            current.filter(
                              (_, aliasIndex) => aliasIndex !== index,
                            ),
                          )
                        }
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {aliases.length === 0 ? (
                    <span className="font-mono text-[11px] text-muted">
                      no aliases
                    </span>
                  ) : null}
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  <input
                    className="input h-8 min-w-0 flex-1 font-mono text-[11px]"
                    placeholder="add alias"
                    aria-label="New competitor alias"
                    value={aliasDraft}
                    onChange={(event) => setAliasDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter') {
                        return;
                      }
                      event.preventDefault();
                      addAlias();
                    }}
                    maxLength={60}
                    disabled={aliases.length >= 10}
                  />
                  <Tooltip
                    asChild
                    content="Match case exactly"
                    className="border-border-strong bg-bg-elevated text-primary shadow-lg"
                  >
                    <button
                      type="button"
                      aria-label="Match case exactly"
                      aria-pressed={aliasCaseSensitive}
                      className={cn(
                        'h-8 border px-2 font-mono text-[11px] transition-colors',
                        aliasCaseSensitive
                          ? 'border-border-strong bg-accent text-on-accent'
                          : 'border-border text-muted hover:text-primary',
                      )}
                      onClick={() =>
                        setAliasCaseSensitive((current) => !current)
                      }
                    >
                      Aa
                    </button>
                  </Tooltip>
                  <button
                    type="button"
                    className="btn-ghost h-8 px-2 font-mono text-[11px]"
                    onClick={addAlias}
                    disabled={aliases.length >= 10 || !aliasDraft.trim()}
                  >
                    add
                  </button>
                </div>
              </div>
            </div>
            <div className="border border-border px-3 py-2 text-[12px] text-muted leading-relaxed">
              {editing
                ? 'Identity and alias changes apply to future runs. Existing scores remain unchanged.'
                : 'Future answers will be scored for this competitor and its aliases across mentions, citations, and position.'}
            </div>
            {formError ? (
              <p className="text-[13px] text-error">{formError}</p>
            ) : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={closeForm}
              >
                cancel
              </button>
              <button type="submit" className="btn-primary" disabled={busy}>
                {busy ? 'saving…' : editing ? 'save changes' : 'add competitor'}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {removing ? (
        <Modal
          title="Remove competitor?"
          onClose={() => {
            setRemoving(null);
            setRemoveError(null);
          }}
        >
          <p className="text-[13px] text-secondary">{removing.name}</p>
          <p className="mt-2 text-[12px] text-muted leading-relaxed">
            Removal only works before a competitor has scored history. Once
            results exist, keep the competitor so historical comparisons remain
            intact.
          </p>
          {removeError ? (
            <p className="mt-2 text-[13px] text-error">{removeError}</p>
          ) : null}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setRemoving(null);
                setRemoveError(null);
              }}
            >
              cancel
            </button>
            <button
              type="button"
              className="btn-secondary text-error"
              onClick={removeCompetitor}
              disabled={removeBusy}
            >
              {removeBusy ? 'removing…' : 'remove competitor'}
            </button>
          </div>
        </Modal>
      ) : null}

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
          title="competitor data unavailable"
          hint={error ?? 'Competitive metrics could not be loaded.'}
          action={
            <button type="button" className="btn-secondary" onClick={refetch}>
              retry
            </button>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          <section
            aria-labelledby="competitive-snapshot"
            aria-busy={loading}
            className="overflow-hidden border border-border"
          >
            <header className="flex min-h-10 items-center border-border border-b bg-bg-elevated px-5 py-2.5">
              <h2
                id="competitive-snapshot"
                className="section-label text-primary"
              >
                Competitive snapshot
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
                  label="Tracked competitors"
                  value={String(competitors.length)}
                  spark={
                    <p className="font-mono text-[11px] text-muted">
                      plus {brand?.name ?? 'your brand'}
                    </p>
                  }
                  className={TILE_CLASS}
                />
                <StatTile
                  label="Brand share of voice"
                  info={METRIC_INFO.shareOfVoice}
                  value={pct(brand?.sov)}
                  spark={
                    <p className="font-mono text-[11px] text-muted">
                      {brand?.name ?? 'your brand'} in this range
                    </p>
                  }
                  className={TILE_CLASS}
                />
                <StatTile
                  label="SOV gap"
                  info={METRIC_INFO.sovGap}
                  value={signedPoints(sovGap)}
                  spark={
                    <p className="font-mono text-[11px] text-muted">
                      {sovGapHint}
                    </p>
                  }
                  className={TILE_CLASS}
                />
                <StatTile
                  label="First named"
                  info={METRIC_INFO.firstNamed}
                  value={pct(brand?.firstMentionShare)}
                  spark={
                    <p className="font-mono text-[11px] text-muted">
                      when a tracked entity was named first
                    </p>
                  }
                  className={TILE_CLASS}
                />
              </div>
            )}
          </section>

          <section
            aria-label="Competitive visibility by AI surface"
            className="grid grid-cols-1 items-stretch gap-4 xl:grid-cols-5"
          >
            <ChartCard
              className="h-full xl:col-span-3"
              title={
                <span className="inline-flex items-center gap-1">
                  <span>
                    mention rate % · by surface · brand + top {RADAR_SERIES - 1}{' '}
                    competitors
                  </span>
                  <MetricInfo
                    label="mention rate"
                    metric={METRIC_INFO.mentionRate}
                  />
                </span>
              }
            >
              {loading && !data ? (
                <Skeleton className="h-80 w-full" />
              ) : radar ? (
                <RadarChart
                  data={radar.rows}
                  config={radar.config}
                  nameKey="surface"
                  margins={{ top: 36 }}
                  bloom="low"
                  className="h-80 w-full"
                >
                  <RadarFrame />
                  {Object.keys(radar.config).map((key) => (
                    <Radar key={key} dataKey={key} variant="dotted" />
                  ))}
                  <Legend isClickable />
                </RadarChart>
              ) : (
                <EmptyState
                  title="not enough surface data"
                  hint="The comparison needs at least three AI surfaces with results in this range."
                  className="min-h-80"
                />
              )}
            </ChartCard>

            <Card className="h-full overflow-hidden p-0 xl:col-span-2">
              <header className="flex items-center border-border border-b bg-bg-elevated px-5 py-3">
                <h2 className="inline-flex items-center gap-1 font-mono text-[11px] text-primary uppercase tracking-[0.1em]">
                  <span>surface leaders · mention rate</span>
                  <MetricInfo
                    label="surface leaders"
                    metric={METRIC_INFO.surfaceLeaders}
                  />
                </h2>
              </header>
              {loading && !data ? (
                <div>
                  {[0, 1, 2, 3, 4].map((index) => (
                    <div
                      key={index}
                      className="flex min-h-[55px] items-center justify-between border-border border-t px-5 first:border-t-0"
                    >
                      <Skeleton className="h-3 w-20" />
                      <Skeleton className="h-3 w-28" />
                    </div>
                  ))}
                </div>
              ) : surfaceLeaders.length === 0 ? (
                <EmptyState
                  title="no surface leaders"
                  hint="This fills in once surface results are available."
                  className="m-5 min-h-64"
                />
              ) : (
                <div>
                  {surfaceLeaders.map((leader) => (
                    <div
                      key={leader.surface}
                      className="flex min-h-[55px] items-center justify-between gap-4 border-border border-t px-5 first:border-t-0"
                    >
                      <div className="min-w-0">
                        <div className="font-mono text-[10px] text-muted uppercase tracking-[0.08em]">
                          {surfaceLabel(leader.surface)}
                        </div>
                        <div className="mt-1 truncate">
                          <EntityChip
                            name={leader.entity.name}
                            sortIndex={ordered.indexOf(leader.entity)}
                          />
                        </div>
                      </div>
                      <span className="shrink-0 font-mono text-[13px] text-primary tabular-nums">
                        {pct(leader.rate)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </section>

          <Card className="overflow-hidden p-0">
            <div className="flex flex-col gap-3 border-border border-b px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <div className="flex items-baseline gap-3">
                  <span className="section-label">tracked entities</span>
                  <span
                    className="font-mono text-[10px] text-muted uppercase tracking-[0.08em]"
                    aria-live="polite"
                  >
                    {resultSummary}
                  </span>
                </div>
                <p className="mt-1 text-[12px] text-muted">
                  Brand and competitor performance across the selected range.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center xl:justify-end">
                <div className="relative sm:w-64">
                  <input
                    type="search"
                    aria-label="Search tracked entities"
                    aria-busy={entitySearch.isPending}
                    className="input h-8 w-full appearance-none pr-8 font-mono text-[11px] [&::-webkit-search-cancel-button]:appearance-none"
                    placeholder="search names or domains"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                  />
                  {searchQuery ? (
                    <button
                      type="button"
                      aria-label="Clear entity search"
                      className="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-muted transition-colors hover:text-primary"
                      onClick={() => setSearchQuery('')}
                    >
                      <DitherIcon name="close" size={12} />
                    </button>
                  ) : null}
                </div>
                <Select
                  value={entityFilter}
                  options={ENTITY_FILTER_OPTIONS}
                  onChange={setEntityFilter}
                  ariaLabel="Filter tracked entities"
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
                className="w-full min-w-[1120px] table-fixed border-collapse text-[13px]"
                aria-busy={loading || entitySearch.isPending}
              >
                <caption className="sr-only">
                  Brand and competitor performance in the selected date range.
                </caption>
                <ColGroup columns={ENTITY_COLUMNS} widths={columns.widths} />
                <thead className="sticky top-12 z-10 lg:top-0">
                  <tr className="bg-bg-elevated shadow-[0_1px_0_var(--color-border)]">
                    <Th
                      label="Entity"
                      sortKey="entity"
                      sort={sort}
                      onToggle={toggle}
                      className="px-4"
                      resizer={resizer('entity', 'entity')}
                    />
                    <Th
                      label="Domains"
                      sortKey="domains"
                      sort={sort}
                      onToggle={toggle}
                      className="px-3"
                      resizer={resizer('domains', 'domains')}
                    />
                    <Th
                      label="Mention rate"
                      info={METRIC_INFO.mentionRate}
                      sortKey="mention"
                      sort={sort}
                      onToggle={toggle}
                      align="right"
                      resizer={resizer('mention', 'mention rate')}
                    />
                    <Th
                      label="Share of voice"
                      info={METRIC_INFO.shareOfVoice}
                      sortKey="sov"
                      sort={sort}
                      onToggle={toggle}
                      align="right"
                      resizer={resizer('sov', 'share of voice')}
                    />
                    <Th
                      label="Avg position"
                      info={METRIC_INFO.averagePosition}
                      sortKey="position"
                      sort={sort}
                      onToggle={toggle}
                      align="right"
                      resizer={resizer('position', 'average position')}
                    />
                    <Th
                      label="Citation rate"
                      info={METRIC_INFO.citationRate}
                      sortKey="citation"
                      sort={sort}
                      onToggle={toggle}
                      align="right"
                      resizer={resizer('citation', 'citation rate')}
                    />
                    <Th
                      label="First named"
                      info={METRIC_INFO.firstNamed}
                      sortKey="first"
                      sort={sort}
                      onToggle={toggle}
                      align="right"
                      resizer={resizer('first', 'first named')}
                    />
                    <Th
                      label="Sentiment"
                      info={METRIC_INFO.sentiment}
                      sortKey="sentiment"
                      sort={sort}
                      onToggle={toggle}
                      align="right"
                      resizer={resizer('sentiment', 'sentiment')}
                    />
                    <Th label="Actions" align="right" className="px-4" />
                  </tr>
                </thead>
                <tbody>
                  {loading && !data ? (
                    Array.from({ length: 6 }, (_, rowIndex) => (
                      <tr key={`entity-skeleton-${rowIndex}`}>
                        {ENTITY_COLUMNS.map((column) => (
                          <td
                            key={column.key}
                            className="h-9 border-border border-t px-3"
                          >
                            <Skeleton
                              className={cn(
                                'h-3',
                                column.key === 'entity' ||
                                  column.key === 'domains'
                                  ? 'w-3/5'
                                  : 'ml-auto w-12',
                              )}
                            />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : pageState.view.length === 0 ? (
                    <tr>
                      <td
                        colSpan={ENTITY_COLUMNS.length}
                        className="border-border border-t px-4 py-10 text-center"
                      >
                        <div className="flex flex-col items-center gap-2">
                          <span className="section-label">
                            no matching entities
                          </span>
                          <p className="text-[13px] text-muted">
                            Try another name, domain, or entity filter.
                          </p>
                          {hasFilters ? (
                            <button
                              type="button"
                              className="btn-secondary mt-1"
                              onClick={clearFilters}
                            >
                              clear filters
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ) : (
                    pageState.view.map((entity) => {
                      const firstDomain = entity.domains[0] ?? '';
                      return (
                        <tr
                          key={entity.id}
                          className="h-9 border-border border-t transition-colors hover:bg-bg-card-hover"
                        >
                          <td className="h-9 px-4">
                            <div className="flex min-w-0 items-center gap-2">
                              <Favicon domain={firstDomain} size={16} />
                              <span className="min-w-0 truncate">
                                <EntityChip
                                  name={entity.name}
                                  sortIndex={ordered.indexOf(entity)}
                                />
                              </span>
                              {entity.isBrand ? (
                                <Badge tone="neutral">brand</Badge>
                              ) : null}
                            </div>
                          </td>
                          <td className="h-9 px-3">
                            <Tooltip
                              asChild
                              content={entity.domains.join(', ')}
                              delay={400}
                              className="border-border-strong bg-bg-elevated text-primary shadow-lg"
                            >
                              <span className="block truncate font-mono text-[11px] text-muted">
                                {firstDomain || '—'}
                                {entity.domains.length > 1
                                  ? ` +${entity.domains.length - 1}`
                                  : ''}
                              </span>
                            </Tooltip>
                          </td>
                          <td className="h-9 px-2 text-right font-mono text-primary tabular-nums">
                            {pct(entity.mentionRate)}
                          </td>
                          <td className="h-9 px-2 text-right font-mono text-primary tabular-nums">
                            {pct(entity.sov)}
                          </td>
                          <td className="h-9 px-2 text-right font-mono text-primary tabular-nums">
                            {position(entity.avgPosition)}
                          </td>
                          <td className="h-9 px-2 text-right font-mono text-primary tabular-nums">
                            {pct(entity.citationRate)}
                          </td>
                          <td className="h-9 px-2 text-right font-mono text-primary tabular-nums">
                            {pct(entity.firstMentionShare)}
                          </td>
                          <td className="h-9 px-2 text-right font-mono text-primary tabular-nums">
                            {sentimentSplit(entity.sentiment)}
                          </td>
                          <td className="h-9 px-4 text-right">
                            {entity.isBrand ? null : (
                              <RowMenu
                                label="Competitor actions"
                                items={[
                                  {
                                    label: 'edit',
                                    onSelect: () => openEdit(entity),
                                  },
                                  {
                                    label: 'remove',
                                    tone: 'danger',
                                    onSelect: () => {
                                      setRemoveError(null);
                                      setRemoving(entity);
                                    },
                                  },
                                ]}
                              />
                            )}
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

          <AliasesCard refreshToken={aliasRefreshToken} onChange={refetch} />
        </div>
      )}
    </>
  );
};
