import type { IFuseOptions } from 'fuse.js';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { Select } from '@/components/controls/Select';
import { DitherIcon } from '@/components/dither/DitherIcon';
import { Sparkline } from '@/components/dither-kit/sparkline';
import { useToast } from '@/components/feedback/Toast';
import { PageHeader } from '@/components/layout/PageHeader';
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
  Badge,
  Card,
  EmptyState,
  MetricInfo,
  Modal,
  OverflowTooltip,
  PromptCategoryTag,
  positiveShare,
  RowMenu,
  SentimentDistTag,
  Skeleton,
} from '@/components/ui';
import {
  type UseFuzzySearchOptions,
  useFuzzySearch,
} from '@/hooks/useFuzzySearch';
import { api, useAsyncAction, useQuery } from '@/lib/api';
import { pct, SURFACE_ORDER, surfaceLabel } from '@/lib/format';
import { useOnKeyPress } from '@/lib/keyboard';
import { METRIC_INFO } from '@/lib/metric-copy';
import { useParamFlag } from '@/lib/params';
import {
  PROMPT_CATEGORIES,
  type PromptCategory,
  promptCategory,
} from '@/lib/prompt-categories';
import type { PromptRow } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/providers/workspace';
import { limitReached, promptLimitMessage } from '../../shared/config';

const ALL_CATEGORIES = 'all categories';
const ALL_STATUSES = 'all statuses';
const ACTIVE_STATUS = 'active';
const RETIRED_STATUS = 'retired';
const STATUS_OPTIONS = [ALL_STATUSES, ACTIVE_STATUS, RETIRED_STATUS];
const PROMPT_PAGE_SIZE = 25;

const promptRowCategory = (row: PromptRow) => promptCategory(row.tags);

const surfaceRate = (row: PromptRow, surface: string) => {
  const stats = row.surfaces.find((item) => item.surface === surface);
  return stats && stats.answers > 0 ? stats.mentionRate : null;
};

const PROMPT_SORTS: SortAccessors<PromptRow> = {
  id: (row) => row.id,
  prompt: (row) => row.text.toLowerCase(),
  category: (row) => promptRowCategory(row).toLowerCase(),
  active: (row) => (row.active ? 1 : 0),
  sentiment: (row) => positiveShare(row.sentiment),
  ...Object.fromEntries(
    SURFACE_ORDER.map((surface) => [
      `s:${surface}`,
      (row: PromptRow) => surfaceRate(row, surface),
    ]),
  ),
};

const PROMPT_COLUMNS: ColumnSpec[] = [
  { key: 'index', min: 48, fraction: 0.04 },
  { key: 'prompt', min: 240, fraction: 0.225 },
  { key: 'category', min: 96, fraction: 0.09 },
  ...SURFACE_ORDER.map((surface) => ({
    key: `surface:${surface}`,
    min: 84,
    fraction: 0.075,
  })),
  { key: 'sentiment', min: 96, fraction: 0.09 },
  { key: 'trend', min: 96, fraction: 0.08 },
  { key: 'status', min: 120, fraction: 0.1 },
];

const EMPTY_PROMPTS: PromptRow[] = [];
const PROMPT_FUSE_OPTIONS: IFuseOptions<PromptRow> = {
  keys: [
    { name: 'text', weight: 0.9 },
    { name: 'tags', weight: 0.1 },
  ],
  threshold: 0.36,
  ignoreDiacritics: true,
  ignoreLocation: true,
  includeMatches: true,
  includeScore: true,
  useTokenSearch: true,
  tokenMatch: 'all',
};
const PROMPT_SEARCH_OPTIONS: UseFuzzySearchOptions<PromptRow> = {
  fuseOptions: PROMPT_FUSE_OPTIONS,
};

const SurfaceCell = ({ row, surface }: { row: PromptRow; surface: string }) => {
  const stats = row.surfaces.find((item) => item.surface === surface);
  // An unanswered prompt has no score. An answered prompt with no signal is a
  // real result, so the two states need different labels.
  if (!stats || stats.answers === 0 || stats.mentionRate === null) {
    return <Badge tone="neutral">—</Badge>;
  }
  if (stats.mentionRate === 0 && (stats.citationRate ?? 0) === 0) {
    return <Badge tone="neutral">none</Badge>;
  }
  return (
    <span className="inline-flex flex-wrap gap-1">
      {stats.mentionRate > 0 ? (
        <Badge tone="ok">m {pct(stats.mentionRate)}</Badge>
      ) : null}
      {(stats.citationRate ?? 0) > 0 ? (
        <Badge tone="info">c {pct(stats.citationRate)}</Badge>
      ) : null}
    </span>
  );
};

export const Prompts = () => {
  const { data, loading, error, refetch } = useQuery<{ prompts: PromptRow[] }>(
    '/prompts?range=all',
  );
  const prompts = data?.prompts ?? EMPTY_PROMPTS;
  const { config } = useWorkspace();
  const toast = useToast();
  const promptLimit = config.limits.maxActivePromptsPerWorkspace;
  const activePromptCount = prompts.filter((prompt) => prompt.active).length;
  const atPromptLimit = limitReached(activePromptCount, promptLimit);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState(ALL_CATEGORIES);
  const [statusFilter, setStatusFilter] = useState(ALL_STATUSES);
  const categoryOptions = useMemo(
    () => [
      ALL_CATEGORIES,
      ...Array.from(new Set(prompts.map(promptRowCategory))).sort((a, b) =>
        a.localeCompare(b),
      ),
    ],
    [prompts],
  );
  const filteredPrompts = useMemo(
    () =>
      prompts.filter((row) => {
        const matchesCategory =
          categoryFilter === ALL_CATEGORIES ||
          promptRowCategory(row) === categoryFilter;
        const matchesStatus =
          statusFilter === ALL_STATUSES ||
          (statusFilter === ACTIVE_STATUS ? row.active : !row.active);
        return matchesCategory && matchesStatus;
      }),
    [categoryFilter, prompts, statusFilter],
  );
  const search = useFuzzySearch(
    filteredPrompts,
    searchQuery,
    PROMPT_SEARCH_OPTIONS,
  );
  const searchRanks = useMemo(
    () =>
      new Map(
        search.results.map((result, index) => [result.item.id, index] as const),
      ),
    [search.results],
  );
  const promptSorts = useMemo<SortAccessors<PromptRow>>(
    () => ({
      ...PROMPT_SORTS,
      relevance: (row) =>
        search.hasQuery
          ? (searchRanks.get(row.id) ?? Number.MAX_SAFE_INTEGER)
          : row.id,
    }),
    [search.hasQuery, searchRanks],
  );
  const { sorted, sort, toggle } = useSort(search.items, promptSorts, {
    key: 'relevance',
    dir: 'asc',
  });
  const pageState = usePagination(sorted, PROMPT_PAGE_SIZE);
  const columnWidths = useColumnWidths('prompts', PROMPT_COLUMNS);
  const [selectedPrompt, setSelectedPrompt] = useState<PromptRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<PromptRow | null>(null);
  const [newPrompt, setNewPrompt] = useState('');
  const [newCategory, setNewCategory] = useState<PromptCategory>(
    PROMPT_CATEGORIES[0],
  );
  const [createdPromptId, setCreatedPromptId] = useState<number | null>(null);
  const {
    busy,
    error: formError,
    setError: setFormError,
    run: runAdd,
  } = useAsyncAction();
  const {
    busy: deleteBusy,
    error: deleteError,
    setError: setDeleteError,
    run: runDelete,
  } = useAsyncAction();

  useEffect(() => {
    pageState.setPage(0);
  }, [categoryFilter, pageState.setPage, searchQuery, statusFilter]);

  useEffect(() => {
    if (createdPromptId === null) {
      return;
    }
    const createdIndex = sorted.findIndex((row) => row.id === createdPromptId);
    if (createdIndex < 0) {
      return;
    }
    pageState.setPage(Math.floor(createdIndex / PROMPT_PAGE_SIZE));
    setCreatedPromptId(null);
  }, [createdPromptId, pageState.setPage, sorted]);

  const openAdd = () => {
    if (atPromptLimit && promptLimit !== null) {
      toast(promptLimitMessage(promptLimit));
      return;
    }
    setFormError(null);
    setAdding(true);
  };

  const closeAdd = () => {
    setAdding(false);
    setNewPrompt('');
    setNewCategory(PROMPT_CATEGORIES[0]);
    setFormError(null);
  };

  const addPrompt = (event: FormEvent) => {
    event.preventDefault();
    runAdd(async () => {
      const created = await api<{ id: number }>('/prompts', {
        method: 'POST',
        body: JSON.stringify({
          text: newPrompt,
          tags: [newCategory],
        }),
      });
      clearFilters();
      setCreatedPromptId(created.id);
      closeAdd();
      refetch();
    });
  };

  useOnKeyPress('a', openAdd, {
    enabled: !adding && !selectedPrompt,
    preventDefault: true,
  });
  useParamFlag('new', openAdd);

  const toggleActive = (row: PromptRow) => {
    if (!row.active && atPromptLimit && promptLimit !== null) {
      toast(promptLimitMessage(promptLimit));
      return;
    }
    void api(`/prompts/${row.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ active: !row.active }),
    })
      .then(() => refetch())
      .catch((cause: unknown) =>
        toast(cause instanceof Error ? cause.message : 'prompt update failed'),
      );
  };

  const deletePrompt = () => {
    if (!deleting) {
      return;
    }
    runDelete(async () => {
      await api(`/prompts/${deleting.id}`, { method: 'DELETE', body: '{}' });
      setDeleting(null);
      refetch();
    });
  };

  const clearFilters = () => {
    setSearchQuery('');
    setCategoryFilter(ALL_CATEGORIES);
    setStatusFilter(ALL_STATUSES);
  };
  const resetTable = () => {
    clearFilters();
    pageState.setPage(0);
    columnWidths.reset();
  };

  const resizer = (key: string, label: string) => (
    <ColResizer
      label={label}
      onStart={(clientX) => columnWidths.startResize(key, clientX)}
      onNudge={(direction) => columnWidths.nudge(key, direction)}
      onReset={columnWidths.reset}
    />
  );

  const resultSummary = loading
    ? data
      ? `${pageState.total} of ${prompts.length} · updating`
      : 'loading prompts'
    : search.isPending
      ? 'searching prompts'
      : `${pageState.total} of ${prompts.length}`;
  const hasFilters =
    searchQuery.trim().length > 0 ||
    categoryFilter !== ALL_CATEGORIES ||
    statusFilter !== ALL_STATUSES;

  return (
    <>
      <PageHeader
        title="Prompts"
        description="Monitor the questions buyers ask and inspect how your brand appears across each AI surface."
        actions={
          <button type="button" className="btn-primary" onClick={openAdd}>
            add prompt
            <kbd className="kbd kbd-invert h-4 min-w-4 text-[10px]">a</kbd>
          </button>
        }
      />

      {adding ? (
        <Modal title="Add prompt" onClose={closeAdd}>
          <form onSubmit={addPrompt} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="field-label">Prompt</span>
              <input
                className="input"
                placeholder="e.g. “What is the best AI assistant for Mac?”"
                value={newPrompt}
                onChange={(event) => setNewPrompt(event.target.value)}
                minLength={8}
                maxLength={500}
                required
                autoFocus
              />
            </label>
            <div className="flex flex-col gap-1.5">
              <span className="field-label">Buyer journey category</span>
              <Select
                value={newCategory}
                options={PROMPT_CATEGORIES}
                onChange={(value) => {
                  const category = PROMPT_CATEGORIES.find(
                    (option) => option === value,
                  );
                  if (category) {
                    setNewCategory(category);
                  }
                }}
                ariaLabel="Prompt category"
                renderOption={(option) => (
                  <PromptCategoryTag
                    category={option}
                    active={option === newCategory}
                  />
                )}
              />
            </div>
            <p className="text-[12px] text-muted">
              New prompts join the next run.{' '}
              {promptLimit === null
                ? 'Your administrator account has no active prompt limit.'
                : `${activePromptCount} of ${promptLimit} active prompts are in use.`}
            </p>
            {formError ? (
              <p className="text-[13px] text-error">{formError}</p>
            ) : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={closeAdd}
              >
                cancel
              </button>
              <button type="submit" className="btn-primary" disabled={busy}>
                {busy ? 'adding…' : 'add prompt'}
              </button>
            </div>
          </form>
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

      {!loading && !data && error ? (
        <EmptyState
          title="prompts unavailable"
          hint="The prompt list could not be loaded. Try again."
          action={
            <button type="button" className="btn-secondary" onClick={refetch}>
              retry
            </button>
          }
        />
      ) : !loading && prompts.length === 0 ? (
        <EmptyState
          title="no prompts yet"
          hint="Add the questions buyers ask to begin monitoring their answers."
          action={
            <button type="button" className="btn-primary" onClick={openAdd}>
              add prompt
            </button>
          }
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="flex flex-col gap-3 border-border border-b px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-baseline gap-3">
              <span className="inline-flex items-center gap-1">
                <span className="section-label">prompt results</span>
                <MetricInfo
                  label="prompt result signals"
                  metric={METRIC_INFO.promptSignals}
                />
              </span>
              <span
                className="font-mono text-[10px] text-muted uppercase tracking-[0.08em]"
                aria-live="polite"
              >
                {resultSummary}
              </span>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center xl:justify-end">
              <div className="relative sm:w-64">
                <input
                  type="search"
                  aria-label="Search prompts"
                  aria-busy={search.isPending}
                  className="input h-8 w-full appearance-none pr-8 font-mono text-[11px] [&::-webkit-search-cancel-button]:appearance-none"
                  placeholder="search prompts"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
                {searchQuery ? (
                  <button
                    type="button"
                    aria-label="Clear prompt search"
                    className="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-muted transition-colors hover:text-primary"
                    onClick={() => setSearchQuery('')}
                  >
                    <DitherIcon name="close" size={12} />
                  </button>
                ) : null}
              </div>
              <Select
                value={categoryFilter}
                options={categoryOptions}
                onChange={setCategoryFilter}
                ariaLabel="Filter prompts by category"
                size="sm"
                className="sm:w-44"
                renderOption={(option) =>
                  option === ALL_CATEGORIES ? (
                    option
                  ) : (
                    <PromptCategoryTag category={option} />
                  )
                }
              />
              <Select
                value={statusFilter}
                options={STATUS_OPTIONS}
                onChange={setStatusFilter}
                ariaLabel="Filter prompts by status"
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
              ref={columnWidths.tableRef}
              className="w-full min-w-[1120px] table-fixed border-collapse text-[13px]"
              aria-busy={loading || search.isPending}
            >
              <caption className="sr-only">
                Prompt performance by category, status, and AI surface.
              </caption>
              <ColGroup columns={PROMPT_COLUMNS} widths={columnWidths.widths} />
              <thead className="sticky top-12 z-10 lg:top-0">
                <tr className="bg-bg-elevated shadow-[0_1px_0_var(--color-border)]">
                  <Th
                    label="#"
                    sortKey="id"
                    sort={sort}
                    onToggle={toggle}
                    align="right"
                    className="px-3"
                    resizer={resizer('index', 'number')}
                  />
                  <Th
                    label="Prompt"
                    sortKey="prompt"
                    sort={sort}
                    onToggle={toggle}
                    className="px-3"
                    resizer={resizer('prompt', 'prompt')}
                  />
                  <Th
                    label="Category"
                    sortKey="category"
                    sort={sort}
                    onToggle={toggle}
                    className="px-3"
                    resizer={resizer('category', 'category')}
                  />
                  {SURFACE_ORDER.map((surface) => (
                    <Th
                      key={surface}
                      label={surfaceLabel(surface)}
                      sortKey={`s:${surface}`}
                      sort={sort}
                      onToggle={toggle}
                      resizer={resizer(
                        `surface:${surface}`,
                        surfaceLabel(surface),
                      )}
                    />
                  ))}
                  <Th
                    label="Sentiment"
                    sortKey="sentiment"
                    sort={sort}
                    onToggle={toggle}
                    resizer={resizer('sentiment', 'sentiment')}
                  />
                  <Th
                    label="Trend"
                    className="px-3"
                    resizer={resizer('trend', 'trend')}
                  />
                  <Th
                    label="Status"
                    sortKey="active"
                    sort={sort}
                    onToggle={toggle}
                    align="right"
                    className="px-3"
                  />
                </tr>
              </thead>
              <tbody>
                {loading && !data ? (
                  Array.from({ length: 8 }, (_, index) => (
                    <tr key={`prompt-skeleton-${index}`}>
                      {PROMPT_COLUMNS.map((column) => (
                        <td
                          key={column.key}
                          className="h-9 border-border border-t px-3"
                        >
                          <Skeleton
                            className={cn(
                              'h-3',
                              column.key === 'prompt' ? 'w-4/5' : 'w-2/3',
                            )}
                          />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : pageState.view.length === 0 ? (
                  <tr>
                    <td
                      colSpan={PROMPT_COLUMNS.length}
                      className="border-border border-t px-4 py-12 text-center"
                    >
                      <div className="flex flex-col items-center gap-2">
                        <span className="section-label">
                          no matching prompts
                        </span>
                        <p className="text-[13px] text-muted">
                          Try another search, category, or status.
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
                  pageState.view.map((row, index) => (
                    <tr
                      key={row.id}
                      {...rowActivation(() => setSelectedPrompt(row))}
                      className="h-9 cursor-pointer border-border border-t transition-colors hover:bg-bg-card-hover focus-visible:bg-bg-card-hover"
                    >
                      <td className="h-9 px-3 text-right font-mono text-[11px] text-muted tabular-nums">
                        {pageState.start + index}
                      </td>
                      <td className="h-9 px-3 text-primary">
                        <OverflowTooltip
                          content={row.text}
                          delay={400}
                          className="max-w-[min(32rem,calc(100vw-1.5rem))] whitespace-normal border-border-strong bg-bg-elevated text-primary shadow-lg"
                        >
                          <p
                            className={cn(
                              'truncate',
                              !row.active && 'text-secondary',
                            )}
                          >
                            {row.text}
                          </p>
                        </OverflowTooltip>
                      </td>
                      <td className="h-9 px-3">
                        <PromptCategoryTag category={promptRowCategory(row)} />
                      </td>
                      {SURFACE_ORDER.map((surface) => (
                        <td key={surface} className="h-9 px-2">
                          <SurfaceCell row={row} surface={surface} />
                        </td>
                      ))}
                      <td className="h-9 px-2">
                        <SentimentDistTag dist={row.sentiment} />
                      </td>
                      <td className="h-9 px-3">
                        {row.trend.length >= 2 ? (
                          <Sparkline
                            data={row.trend.map(
                              (point) => point.mentionRate ?? 0,
                            )}
                            color="green"
                            variant="solid"
                            className="h-5 w-full min-w-16"
                          />
                        ) : (
                          <span className="font-mono text-[11px] text-muted">
                            —
                          </span>
                        )}
                      </td>
                      <td className="h-9 px-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <Badge tone={row.active ? 'ok' : 'neutral'}>
                            {row.active ? ACTIVE_STATUS : RETIRED_STATUS}
                          </Badge>
                          <RowMenu
                            label="Prompt actions"
                            items={[
                              {
                                label: row.active ? 'retire' : 'activate',
                                onSelect: () => toggleActive(row),
                              },
                              {
                                label: 'delete',
                                tone: 'danger',
                                onSelect: () => {
                                  setDeleteError(null);
                                  setDeleting(row);
                                },
                              },
                            ]}
                          />
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <Pagination state={pageState} />
        </Card>
      )}

      {deleting ? (
        <Modal title="Delete prompt?" onClose={() => setDeleting(null)}>
          <p className="text-[13px] text-secondary">“{deleting.text}”</p>
          <p className="mt-2 text-[12px] text-muted">
            Deletion only works for prompts with no run history. Prompts that
            already have results should be retired instead, so trends stay
            intact.
          </p>
          {deleteError ? (
            <p className="mt-2 text-[13px] text-error">{deleteError}</p>
          ) : null}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setDeleting(null)}
            >
              cancel
            </button>
            <button
              type="button"
              className="btn-secondary text-error"
              onClick={deletePrompt}
              disabled={deleteBusy}
            >
              {deleteBusy ? 'deleting…' : 'delete prompt'}
            </button>
          </div>
        </Modal>
      ) : null}
      {selectedPrompt ? (
        <PromptPane
          prompt={selectedPrompt}
          onClose={() => setSelectedPrompt(null)}
        />
      ) : null}
    </>
  );
};
