import { METRIC_INFO } from '@refd/core/metric-copy';
import type { IFuseOptions } from 'fuse.js';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { RangePicker, useRange } from '@/components/controls/RangePicker';
import { Select } from '@/components/controls/Select';
import { DitherIcon } from '@/components/dither/DitherIcon';
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
  CitationUrl,
  EmptyState,
  Favicon,
  MetricInfo,
  Skeleton,
  StatTile,
} from '@/components/ui';
import {
  type UseFuzzySearchOptions,
  useFuzzySearch,
} from '@/hooks/useFuzzySearch';
import { useQuery } from '@/lib/api';
import type { SourcesResponse } from '@/lib/types';
import { cn } from '@/lib/utils';

type DomainRow = SourcesResponse['domains'][number];
type GapRow = SourcesResponse['gap'][number];
type UrlRow = SourcesResponse['ourUrls'][number];

const ALL_DOMAINS = 'all domains';
const OUR_DOMAINS = 'our domains';
const EXTERNAL_DOMAINS = 'external domains';
const DOMAIN_FILTER_OPTIONS = [ALL_DOMAINS, OUR_DOMAINS, EXTERNAL_DOMAINS];

const DOMAIN_SORTS: SortAccessors<DomainRow> = {
  domain: (row) => row.domain.toLowerCase(),
  answers: (row) => row.resultCount,
  citations: (row) => row.citationCount,
};
const GAP_SORTS: SortAccessors<GapRow> = {
  domain: (row) => row.domain.toLowerCase(),
  answers: (row) => row.resultCount,
};
const URL_SORTS: SortAccessors<UrlRow> = {
  url: (row) => row.url.toLowerCase(),
  count: (row) => row.count,
};

const DOMAIN_COLUMNS: ColumnSpec[] = [
  { key: 'domain', min: 300, fraction: 0.66 },
  { key: 'answers', min: 120, fraction: 0.17 },
  { key: 'citations', min: 120, fraction: 0.17 },
];
const GAP_COLUMNS: ColumnSpec[] = [
  { key: 'domain', min: 260, fraction: 0.78 },
  { key: 'answers', min: 120, fraction: 0.22 },
];
const URL_COLUMNS: ColumnSpec[] = [
  { key: 'url', min: 360, fraction: 0.84 },
  { key: 'count', min: 96, fraction: 0.16 },
];

const EMPTY_DOMAINS: DomainRow[] = [];
const EMPTY_GAPS: GapRow[] = [];
const EMPTY_URLS: UrlRow[] = [];
const DOMAIN_FUSE_OPTIONS: IFuseOptions<DomainRow> = {
  keys: ['domain'],
  threshold: 0.32,
  ignoreDiacritics: true,
  ignoreLocation: true,
  includeMatches: true,
  includeScore: true,
};
const DOMAIN_SEARCH_OPTIONS: UseFuzzySearchOptions<DomainRow> = {
  fuseOptions: DOMAIN_FUSE_OPTIONS,
};
const TILE_CLASS = 'min-h-[124px] border-0 bg-bg-elevated';

const TableSkeletonRows = ({
  columns,
  rows,
}: {
  columns: ColumnSpec[];
  rows: number;
}) =>
  Array.from({ length: rows }, (_, rowIndex) => (
    <tr key={`source-skeleton-${columns.length}-${rowIndex}`}>
      {columns.map((column) => (
        <td key={column.key} className="h-9 border-border border-t px-4">
          <Skeleton
            className={cn(
              'h-3',
              column.key === 'domain' || column.key === 'url'
                ? 'w-3/5'
                : 'ml-auto w-12',
            )}
          />
        </td>
      ))}
    </tr>
  ));

const EmptyTableRow = ({
  colSpan,
  title,
  hint,
  action,
}: {
  colSpan: number;
  title: string;
  hint?: string;
  action?: ReactNode;
}) => (
  <tr>
    <td colSpan={colSpan} className="border-border border-t px-4 py-10">
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="section-label">{title}</span>
        {hint ? <p className="text-[13px] text-muted">{hint}</p> : null}
        {action ? <div className="mt-1">{action}</div> : null}
      </div>
    </td>
  </tr>
);

export const Sources = () => {
  const [range, setRange] = useRange();
  const { data, loading, error, refetch } = useQuery<SourcesResponse>(
    `/sources?range=${range}`,
  );
  const domainRows = data?.domains ?? EMPTY_DOMAINS;
  const gapRows = data?.gap ?? EMPTY_GAPS;
  const urlRows = data?.ourUrls ?? EMPTY_URLS;
  const [searchQuery, setSearchQuery] = useState('');
  const [domainFilter, setDomainFilter] = useState(ALL_DOMAINS);
  const filteredDomains = useMemo(
    () =>
      domainRows.filter((row) => {
        if (domainFilter === OUR_DOMAINS) {
          return row.isOurs;
        }
        if (domainFilter === EXTERNAL_DOMAINS) {
          return !row.isOurs;
        }
        return true;
      }),
    [domainFilter, domainRows],
  );
  const domainSearch = useFuzzySearch(
    filteredDomains,
    searchQuery,
    DOMAIN_SEARCH_OPTIONS,
  );
  const domains = useSort(domainSearch.items, DOMAIN_SORTS, {
    key: 'answers',
    dir: 'desc',
  });
  const gap = useSort(gapRows, GAP_SORTS, {
    key: 'answers',
    dir: 'desc',
  });
  const ourUrls = useSort(urlRows, URL_SORTS, {
    key: 'count',
    dir: 'desc',
  });
  const domainsPage = usePagination(domains.sorted, 10);
  const gapPage = usePagination(gap.sorted, 10);
  const ourUrlsPage = usePagination(ourUrls.sorted, 10);
  const domainColumns = useColumnWidths('source-domains', DOMAIN_COLUMNS);
  const gapColumns = useColumnWidths('source-gaps', GAP_COLUMNS);
  const urlColumns = useColumnWidths('source-urls', URL_COLUMNS);

  useEffect(() => {
    domainsPage.setPage(0);
  }, [domainFilter, domainsPage.setPage, searchQuery]);

  const metrics = useMemo(
    () => ({
      domains: domainRows.length,
      attributed: domainRows.reduce(
        (total, row) => total + row.citationCount,
        0,
      ),
      brand: urlRows.reduce((total, row) => total + row.count, 0),
      gaps: gapRows.length,
    }),
    [domainRows, gapRows.length, urlRows],
  );

  const clearDomainFilters = () => {
    setSearchQuery('');
    setDomainFilter(ALL_DOMAINS);
  };
  const hasDomainFilters =
    searchQuery.trim().length > 0 || domainFilter !== ALL_DOMAINS;
  const resultSummary = loading
    ? data
      ? `${domainsPage.total} of ${domainRows.length} · updating`
      : 'loading domains'
    : domainSearch.isPending
      ? 'searching domains'
      : `${domainsPage.total} of ${domainRows.length}`;

  const resetTables = () => {
    clearDomainFilters();
    domainsPage.setPage(0);
    gapPage.setPage(0);
    ourUrlsPage.setPage(0);
    domainColumns.reset();
    gapColumns.reset();
    urlColumns.reset();
  };

  return (
    <>
      <PageHeader
        title="Sources"
        description="See which domains AI answers trust, where your brand is cited, and where source authority is missing."
        actions={<RangePicker value={range} onChange={setRange} />}
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

      {!loading && !data && error ? (
        <EmptyState
          title="sources unavailable"
          hint="Source data could not be loaded for this range. Try again."
          action={
            <button type="button" className="btn-secondary" onClick={refetch}>
              retry
            </button>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          <section
            aria-labelledby="source-snapshot"
            aria-busy={loading}
            className="overflow-hidden border border-border"
          >
            <header className="flex min-h-10 items-center border-border border-b bg-bg-elevated px-5 py-2.5">
              <h2 id="source-snapshot" className="section-label text-primary">
                Source snapshot
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
                  label="Cited domains"
                  value={String(metrics.domains)}
                  spark={
                    <p className="font-mono text-[11px] text-muted">
                      attributable domains in range
                    </p>
                  }
                  className={TILE_CLASS}
                />
                <StatTile
                  label="Attributed citations"
                  info={METRIC_INFO.attributedCitations}
                  value={String(metrics.attributed)}
                  spark={
                    <p className="font-mono text-[11px] text-muted">
                      excluding opaque redirects
                    </p>
                  }
                  className={TILE_CLASS}
                />
                <StatTile
                  label="Brand URL citations"
                  info={METRIC_INFO.brandUrlCitations}
                  value={String(metrics.brand)}
                  spark={
                    <p className="font-mono text-[11px] text-muted">
                      across {urlRows.length} cited brand URLs
                    </p>
                  }
                  className={TILE_CLASS}
                />
                <StatTile
                  label="Gap domains"
                  info={METRIC_INFO.sourceGap}
                  value={String(metrics.gaps)}
                  spark={
                    <p className="font-mono text-[11px] text-muted">
                      cited while your brand was absent
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
                  <span className="section-label">cited domains</span>
                  <span
                    className="font-mono text-[10px] text-muted uppercase tracking-[0.08em]"
                    aria-live="polite"
                  >
                    {resultSummary}
                  </span>
                </div>
                <p className="mt-1 text-[12px] text-muted">
                  Ranked by the number of distinct answers citing each domain.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center xl:justify-end">
                <div className="relative sm:w-64">
                  <input
                    type="search"
                    aria-label="Search cited domains"
                    aria-busy={domainSearch.isPending}
                    className="input h-8 w-full appearance-none pr-8 font-mono text-[11px] [&::-webkit-search-cancel-button]:appearance-none"
                    placeholder="search domains"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                  />
                  {searchQuery ? (
                    <button
                      type="button"
                      aria-label="Clear domain search"
                      className="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-muted transition-colors hover:text-primary"
                      onClick={() => setSearchQuery('')}
                    >
                      <DitherIcon name="close" size={12} />
                    </button>
                  ) : null}
                </div>
                <Select
                  value={domainFilter}
                  options={DOMAIN_FILTER_OPTIONS}
                  onChange={setDomainFilter}
                  ariaLabel="Filter cited domains by relationship"
                  size="sm"
                  className="sm:w-40"
                />
                <button
                  type="button"
                  className="btn-ghost h-8 px-2 font-mono text-[11px]"
                  onClick={resetTables}
                >
                  reset
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table
                ref={domainColumns.tableRef}
                className="w-full min-w-[720px] table-fixed border-collapse text-[13px]"
                aria-busy={loading || domainSearch.isPending}
              >
                <caption className="sr-only">
                  Domains cited by AI answers in the selected date range.
                </caption>
                <ColGroup
                  columns={DOMAIN_COLUMNS}
                  widths={domainColumns.widths}
                />
                <thead className="sticky top-12 z-10 lg:top-0">
                  <tr className="bg-bg-elevated shadow-[0_1px_0_var(--color-border)]">
                    <Th
                      label="Domain"
                      sortKey="domain"
                      sort={domains.sort}
                      onToggle={domains.toggle}
                      className="px-4"
                      resizer={
                        <ColResizer
                          label="domain"
                          onStart={(clientX) =>
                            domainColumns.startResize('domain', clientX)
                          }
                          onNudge={(direction) =>
                            domainColumns.nudge('domain', direction)
                          }
                          onReset={domainColumns.reset}
                        />
                      }
                    />
                    <Th
                      label="Answers citing"
                      info={METRIC_INFO.answersCiting}
                      sortKey="answers"
                      sort={domains.sort}
                      onToggle={domains.toggle}
                      align="right"
                      resizer={
                        <ColResizer
                          label="answers citing"
                          onStart={(clientX) =>
                            domainColumns.startResize('answers', clientX)
                          }
                          onNudge={(direction) =>
                            domainColumns.nudge('answers', direction)
                          }
                          onReset={domainColumns.reset}
                        />
                      }
                    />
                    <Th
                      label="Citations"
                      info={METRIC_INFO.citations}
                      sortKey="citations"
                      sort={domains.sort}
                      onToggle={domains.toggle}
                      align="right"
                      className="px-4"
                    />
                  </tr>
                </thead>
                <tbody>
                  {loading && !data ? (
                    <TableSkeletonRows columns={DOMAIN_COLUMNS} rows={8} />
                  ) : domainsPage.view.length === 0 ? (
                    <EmptyTableRow
                      colSpan={DOMAIN_COLUMNS.length}
                      title={
                        hasDomainFilters
                          ? 'no matching domains'
                          : 'no cited domains'
                      }
                      hint={
                        hasDomainFilters
                          ? 'Try another search or relationship filter.'
                          : 'No attributable source domains were found in this range.'
                      }
                      action={
                        hasDomainFilters ? (
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={clearDomainFilters}
                          >
                            clear filters
                          </button>
                        ) : null
                      }
                    />
                  ) : (
                    domainsPage.view.map((row) => (
                      <tr
                        key={`${row.domain}-${row.isOurs}`}
                        className="h-9 border-border border-t transition-colors hover:bg-bg-card-hover"
                      >
                        <td className="h-9 px-4">
                          <div className="flex min-w-0 items-center gap-2">
                            <Favicon domain={row.domain} size={16} />
                            <span className="truncate text-primary">
                              {row.domain}
                            </span>
                            {row.isOurs ? <Badge tone="ok">ours</Badge> : null}
                          </div>
                        </td>
                        <td className="h-9 px-2 text-right font-mono text-primary tabular-nums">
                          {row.resultCount}
                        </td>
                        <td className="h-9 px-4 text-right font-mono text-primary tabular-nums">
                          {row.citationCount}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <Pagination state={domainsPage} />
            {data && data.unattributable > 0 ? (
              <p className="border-border border-t px-4 py-2 font-mono text-[10px] text-muted uppercase leading-relaxed tracking-[0.06em]">
                {data.unattributable} opaque redirect citation
                {data.unattributable === 1 ? '' : 's'} counted but not
                attributed to a domain
              </p>
            ) : null}
          </Card>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card className="flex h-full min-w-0 flex-col overflow-hidden p-0">
              <div className="flex min-h-20 flex-col justify-center border-border border-b px-4 py-3 xl:h-24">
                <div className="flex items-center gap-1">
                  <span className="section-label">source gap</span>
                  <MetricInfo
                    label="source gap"
                    metric={METRIC_INFO.sourceGap}
                  />
                </div>
                <p className="mt-1 max-w-xl text-[12px] text-muted leading-relaxed">
                  Domains cited in answers where your brand was neither
                  mentioned nor cited. These are useful targets for earning a
                  presence.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table
                  ref={gapColumns.tableRef}
                  className="w-full min-w-[480px] table-fixed border-collapse text-[13px]"
                  aria-busy={loading}
                >
                  <caption className="sr-only">
                    Domains cited where the monitored brand is absent.
                  </caption>
                  <ColGroup columns={GAP_COLUMNS} widths={gapColumns.widths} />
                  <thead className="sticky top-12 z-10 lg:top-0">
                    <tr className="bg-bg-elevated shadow-[0_1px_0_var(--color-border)]">
                      <Th
                        label="Domain"
                        sortKey="domain"
                        sort={gap.sort}
                        onToggle={gap.toggle}
                        className="px-4"
                        resizer={
                          <ColResizer
                            label="source gap domain"
                            onStart={(clientX) =>
                              gapColumns.startResize('domain', clientX)
                            }
                            onNudge={(direction) =>
                              gapColumns.nudge('domain', direction)
                            }
                            onReset={gapColumns.reset}
                          />
                        }
                      />
                      <Th
                        label="Answers citing"
                        info={METRIC_INFO.answersCiting}
                        sortKey="answers"
                        sort={gap.sort}
                        onToggle={gap.toggle}
                        align="right"
                        className="px-4"
                      />
                    </tr>
                  </thead>
                  <tbody>
                    {loading && !data ? (
                      <TableSkeletonRows columns={GAP_COLUMNS} rows={6} />
                    ) : gapPage.view.length === 0 ? (
                      <EmptyTableRow
                        colSpan={GAP_COLUMNS.length}
                        title="no source gap"
                        hint="No gap domains were found in this range."
                      />
                    ) : (
                      gapPage.view.map((row) => (
                        <tr
                          key={row.domain}
                          className="h-9 border-border border-t transition-colors hover:bg-bg-card-hover"
                        >
                          <td className="h-9 px-4">
                            <div className="flex min-w-0 items-center gap-2">
                              <Favicon domain={row.domain} size={16} />
                              <span className="truncate text-primary">
                                {row.domain}
                              </span>
                            </div>
                          </td>
                          <td className="h-9 px-4 text-right font-mono text-primary tabular-nums">
                            {row.resultCount}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <Pagination state={gapPage} />
            </Card>

            <Card className="flex h-full min-w-0 flex-col overflow-hidden p-0">
              <div className="flex min-h-20 flex-col justify-center border-border border-b px-4 py-3 xl:h-24">
                <span className="section-label">our cited URLs</span>
                <p className="mt-1 max-w-xl text-[12px] text-muted leading-relaxed">
                  The exact pages from your domain that AI answers cite most
                  often.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table
                  ref={urlColumns.tableRef}
                  className="w-full min-w-[560px] table-fixed border-collapse text-[13px]"
                  aria-busy={loading}
                >
                  <caption className="sr-only">
                    Brand-owned URLs cited by AI answers.
                  </caption>
                  <ColGroup columns={URL_COLUMNS} widths={urlColumns.widths} />
                  <thead className="sticky top-12 z-10 lg:top-0">
                    <tr className="bg-bg-elevated shadow-[0_1px_0_var(--color-border)]">
                      <Th
                        label="URL"
                        sortKey="url"
                        sort={ourUrls.sort}
                        onToggle={ourUrls.toggle}
                        className="px-4"
                        resizer={
                          <ColResizer
                            label="cited URL"
                            onStart={(clientX) =>
                              urlColumns.startResize('url', clientX)
                            }
                            onNudge={(direction) =>
                              urlColumns.nudge('url', direction)
                            }
                            onReset={urlColumns.reset}
                          />
                        }
                      />
                      <Th
                        label="Citations"
                        info={METRIC_INFO.brandUrlCitations}
                        sortKey="count"
                        sort={ourUrls.sort}
                        onToggle={ourUrls.toggle}
                        align="right"
                        className="px-4"
                      />
                    </tr>
                  </thead>
                  <tbody>
                    {loading && !data ? (
                      <TableSkeletonRows columns={URL_COLUMNS} rows={6} />
                    ) : ourUrlsPage.view.length === 0 ? (
                      <EmptyTableRow
                        colSpan={URL_COLUMNS.length}
                        title="no brand citations"
                        hint="No URLs from your domain were cited in this range."
                      />
                    ) : (
                      ourUrlsPage.view.map((row) => (
                        <tr
                          key={row.url}
                          className="h-9 border-border border-t transition-colors hover:bg-bg-card-hover"
                        >
                          <td className="h-9 px-4">
                            <CitationUrl url={row.url} className="block" />
                          </td>
                          <td className="h-9 px-4 text-right font-mono text-primary tabular-nums">
                            {row.count}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <Pagination state={ourUrlsPage} />
            </Card>
          </div>
        </div>
      )}
    </>
  );
};
