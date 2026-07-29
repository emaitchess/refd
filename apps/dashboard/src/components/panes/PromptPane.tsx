import { useState } from 'react';
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
import { Badge, EmptyState, SectionLabel } from '@/components/ui';
import { useQuery } from '@/lib/api';
import { SURFACE_ORDER, surfaceLabel } from '@/lib/format';
import type { PromptRow } from '@/lib/types';
import { ResultPane } from './ResultPane';
import { SidePane } from './SidePane';

interface LatestRun {
  runId?: number;
  date?: string;
  results: {
    id: number;
    surface: string;
    sample: number;
    ok: boolean;
    answerPresent: boolean;
    totalUrls: number;
    error: string | null;
  }[];
}

type ResultRow = LatestRun['results'][number];

const RESULT_PAGE_SIZE = 5;
const RESULT_COLUMNS: ColumnSpec[] = [
  { key: 'surface', min: 132, fraction: 0.36 },
  { key: 'sample', min: 72, fraction: 0.16 },
  { key: 'status', min: 96, fraction: 0.25 },
  { key: 'citations', min: 88, fraction: 0.23 },
];
const RESULT_SORTS: SortAccessors<ResultRow> = {
  surface: (row) => {
    const index = SURFACE_ORDER.indexOf(row.surface);
    return index === -1 ? SURFACE_ORDER.length : index;
  },
  sample: (row) => row.sample,
  status: (row) => (row.ok ? (row.answerPresent ? 2 : 1) : 0),
  citations: (row) => row.totalUrls,
};

const PromptResultsTable = ({
  results,
  onSelect,
}: {
  results: ResultRow[];
  onSelect: (resultId: number) => void;
}) => {
  const sorted = useSort(results, RESULT_SORTS, {
    key: 'surface',
    dir: 'asc',
  });
  const page = usePagination(sorted.sorted, RESULT_PAGE_SIZE);
  const columns = useColumnWidths('prompt-pane-results', RESULT_COLUMNS);
  const toggleSort = (key: string) => {
    sorted.toggle(key);
    page.setPage(0);
  };
  const resizer = (key: string, label: string) => (
    <ColResizer
      label={label}
      onStart={(clientX) => columns.startResize(key, clientX)}
      onNudge={(direction) => columns.nudge(key, direction)}
      onReset={columns.reset}
    />
  );

  return (
    <div className="mt-2 overflow-hidden border border-border">
      <div className="overflow-x-auto">
        <table
          ref={columns.tableRef}
          className="w-full min-w-[440px] table-fixed border-collapse text-[13px]"
        >
          <caption className="sr-only">
            Results from the latest run. Select a row to view its full response.
          </caption>
          <ColGroup columns={RESULT_COLUMNS} widths={columns.widths} />
          <thead className="sticky top-0 z-10">
            <tr className="bg-bg-elevated shadow-[0_1px_0_var(--color-border)]">
              <Th
                label="Surface"
                sortKey="surface"
                sort={sorted.sort}
                onToggle={toggleSort}
                className="px-3"
                resizer={resizer('surface', 'surface')}
              />
              <Th
                label="Sample"
                sortKey="sample"
                sort={sorted.sort}
                onToggle={toggleSort}
                align="right"
                resizer={resizer('sample', 'sample')}
              />
              <Th
                label="Status"
                sortKey="status"
                sort={sorted.sort}
                onToggle={toggleSort}
                resizer={resizer('status', 'status')}
              />
              <Th
                label="Citations"
                sortKey="citations"
                sort={sorted.sort}
                onToggle={toggleSort}
                align="right"
                className="px-3"
              />
            </tr>
          </thead>
          <tbody>
            {page.view.map((row) => (
              <tr
                key={row.id}
                {...rowActivation(() => onSelect(row.id))}
                className="h-9 cursor-pointer border-border border-t transition-colors hover:bg-bg-card-hover focus-visible:bg-bg-card-hover"
              >
                <td className="h-9 px-3 text-primary">
                  <span className="flex items-center gap-2">
                    <SurfaceLogo
                      surface={row.surface}
                      className="h-3.5 w-3.5 shrink-0 text-secondary"
                    />
                    <span className="truncate">
                      {surfaceLabel(row.surface)}
                    </span>
                  </span>
                </td>
                <td className="h-9 px-2 text-right font-mono tabular-nums">
                  {row.sample}
                </td>
                <td className="h-9 px-2">
                  {row.ok ? (
                    row.answerPresent ? (
                      <Badge tone="ok">ok</Badge>
                    ) : (
                      <Badge tone="neutral">no AIO</Badge>
                    )
                  ) : (
                    <Badge tone="fail">failed</Badge>
                  )}
                </td>
                <td className="h-9 px-3 text-right font-mono text-primary tabular-nums">
                  {row.totalUrls}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination state={page} />
    </div>
  );
};

// Latest run's results for one prompt; clicking a row opens the full detail.
export const PromptPane = ({
  prompt,
  onClose,
}: {
  prompt: PromptRow;
  onClose: () => void;
}) => {
  const { data, error, loading } = useQuery<LatestRun>(
    `/prompts/${prompt.id}/latest`,
  );
  const [resultId, setResultId] = useState<number | null>(null);
  const [resultClosing, setResultClosing] = useState(false);

  return (
    <SidePane
      label={
        <>
          latest run{data?.date ? ` · ${data.date}` : ''}
          {data?.runId ? ` · #${data.runId}` : ''}
        </>
      }
      title={<p className="text-[14px] text-primary">{prompt.text}</p>}
      onClose={onClose}
      escapeEnabled={resultId === null}
      blurred={resultId !== null && !resultClosing}
      overlay={
        resultId !== null && data?.runId ? (
          <ResultPane
            runId={String(data.runId)}
            resultId={resultId}
            onClose={() => {
              setResultId(null);
              setResultClosing(false);
            }}
            onCloseStart={() => setResultClosing(true)}
            nested
          />
        ) : null
      }
    >
      {error ? <p className="text-[13px] text-error">{error}</p> : null}
      {loading || !data ? (
        <p className="font-mono text-[12px] text-muted">loading…</p>
      ) : data.results.length === 0 ? (
        <EmptyState
          title="no results yet"
          hint="This prompt has not been part of a run."
        />
      ) : (
        <section>
          <SectionLabel>results · {data.results.length}</SectionLabel>
          <p className="mt-1 text-[12px] text-muted">
            Select a result to view its full response.
          </p>
          <PromptResultsTable
            results={data.results}
            onSelect={(selectedResultId) => {
              setResultClosing(false);
              setResultId(selectedResultId);
            }}
          />
        </section>
      )}
    </SidePane>
  );
};
