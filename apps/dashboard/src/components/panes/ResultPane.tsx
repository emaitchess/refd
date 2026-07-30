import { type ReactNode, useEffect, useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { DitherIcon } from '@/components/dither/DitherIcon';
import type { DitherColor } from '@/components/dither-kit/palette';
import { Tooltip } from '@/components/dither-kit/tooltip';
import { SurfaceLogo } from '@/components/svgs/SurfaceLogo';
import {
  ColGroup,
  ColResizer,
  Pagination,
  Th,
  useColumnWidths,
  usePagination,
} from '@/components/table/table';
import {
  Badge,
  CitationUrl,
  EntityChip,
  Favicon,
  SectionLabel,
  SentimentTag,
} from '@/components/ui';
import { ANALYTICS_EVENTS, trackEvent } from '@/lib/analytics';
import { apiPath, useQuery as useApiQuery } from '@/lib/api';
import { SERIES_HEX, seriesColor } from '@/lib/chart-colors';
import { position as fmtPosition, surfaceLabel, timestamp } from '@/lib/format';
import { type HighlightEntity, rehypeHighlightEntities } from '@/lib/highlight';
import { SidePane } from './SidePane';

export interface ResultDetail {
  result: {
    id: number;
    promptText: string;
    surface: string;
    sample: number;
    provider: string;
    ok: boolean;
    answerPresent: boolean;
    totalUrls: number;
    error: string | null;
    durationMs: number | null;
    hasRaw: boolean;
    createdAt: number;
  };
  scores: {
    name: string;
    domains: string[];
    aliases: { value: string; caseSensitive?: boolean }[];
    isBrand: boolean;
    sortOrder: number;
    mentioned: boolean;
    cited: boolean;
    position: number | null;
    sentiment: 'positive' | 'neutral' | 'negative' | null;
  }[];
  citations: { url: string; isOurs: boolean }[];
  answerText: string | null;
}

// Half-width overlay pane with everything captured for one prompt run.
const CITATIONS_PAGE_SIZE = 5;
const CITATION_COLUMNS = [
  { key: 'url', min: 160, fraction: 0.76 },
  { key: 'relationship', min: 92, fraction: 0.24 },
];

const CitationTable = ({
  citations,
}: {
  citations: ResultDetail['citations'];
}) => {
  const [query, setQuery] = useState('');
  const columns = useColumnWidths('result-pane-citations', CITATION_COLUMNS);
  const filteredCitations = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) {
      return citations;
    }
    return citations.filter((citation) =>
      citation.url.toLocaleLowerCase().includes(normalizedQuery),
    );
  }, [citations, query]);
  const page = usePagination(filteredCitations, CITATIONS_PAGE_SIZE);
  const updateQuery = (value: string) => {
    setQuery(value);
    page.setPage(0);
  };

  return (
    <div className="mt-2">
      <div className="relative">
        <input
          type="search"
          aria-label="Search citations"
          className="input h-8 w-full appearance-none pr-8 font-mono text-[11px] [&::-webkit-search-cancel-button]:appearance-none"
          placeholder="search citations"
          value={query}
          onChange={(event) => updateQuery(event.target.value)}
        />
        {query ? (
          <button
            type="button"
            aria-label="Clear citation search"
            className="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-muted transition-colors hover:text-primary"
            onClick={() => updateQuery('')}
          >
            <DitherIcon name="close" size={12} />
          </button>
        ) : null}
      </div>
      <div className="mt-2 overflow-hidden border border-border">
        <div className="overflow-x-auto">
          <table
            ref={columns.tableRef}
            className="w-full table-fixed border-collapse text-[13px]"
          >
            <caption className="sr-only">
              URLs cited in this answer and their relationship to the monitored
              brand.
            </caption>
            <ColGroup columns={CITATION_COLUMNS} widths={columns.widths} />
            <thead className="sticky top-0 z-10">
              <tr className="bg-bg-elevated shadow-[0_1px_0_var(--color-border)]">
                <Th
                  label="URL"
                  className="px-3"
                  resizer={
                    <ColResizer
                      label="citation URL"
                      onStart={(clientX) => columns.startResize('url', clientX)}
                      onNudge={(direction) => columns.nudge('url', direction)}
                      onReset={columns.reset}
                    />
                  }
                />
                <Th label="Relationship" align="right" className="px-3" />
              </tr>
            </thead>
            <tbody>
              {page.view.length === 0 ? (
                <tr>
                  <td
                    colSpan={CITATION_COLUMNS.length}
                    className="border-border border-t px-3 py-8 text-center font-mono text-[11px] text-muted"
                  >
                    no matching citations
                  </td>
                </tr>
              ) : (
                page.view.map((citation) => (
                  <tr
                    key={citation.url}
                    className="h-9 border-border border-t transition-colors hover:bg-bg-card-hover"
                  >
                    <td className="h-9 min-w-0 px-3">
                      <CitationUrl url={citation.url} className="block" />
                    </td>
                    <td className="h-9 px-3 text-right">
                      {citation.isOurs ? (
                        <Badge tone="ok">ours</Badge>
                      ) : (
                        <span className="font-mono text-[11px] text-muted">
                          external
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pagination state={page} />
      </div>
    </div>
  );
};

// An entity mention inside the answer: favicon + the text as the answer wrote
// it, tinted with the entity's series colour. The tint carries identity; the
// text keeps its own token (DESIGN.md). Rendered from the <mark> nodes the
// rehype plugin injected, so the properties come from our own AST, not the page.
const EntityMark = ({
  node,
  children,
}: {
  node?: { properties?: Record<string, unknown> };
  children: ReactNode;
}) => {
  const props = node?.properties ?? {};
  const color = typeof props.dataColor === 'string' ? props.dataColor : 'grey';
  const domain = typeof props.dataDomain === 'string' ? props.dataDomain : '';
  const hex = SERIES_HEX[color as DitherColor] ?? SERIES_HEX.grey;
  return (
    <mark
      className="mx-[1px] inline-flex items-center gap-1 px-1 align-baseline text-primary"
      style={{
        backgroundColor: `color-mix(in srgb, ${hex} 22%, transparent)`,
      }}
    >
      {domain ? (
        <Favicon domain={domain} size={12} className="translate-y-[1px]" />
      ) : null}
      {children}
    </mark>
  );
};

export const ResultPane = ({
  runId,
  resultId,
  onClose,
  onCloseStart,
  nested = false,
}: {
  runId: string;
  resultId: number;
  onClose: () => void;
  onCloseStart?: () => void;
  nested?: boolean;
}) => {
  const { data, error, loading } = useApiQuery<ResultDetail>(
    `/runs/${runId}/results/${resultId}`,
  );

  // The activation funnel's "inspected the evidence" step. This pane is the only
  // way into a raw answer and its citations, from both the dashboard and the
  // onboarding report.
  useEffect(() => {
    trackEvent(ANALYTICS_EVENTS.evidenceOpened);
  }, []);

  // Colour by the entity's own sortOrder position, so a mention in the answer
  // wears the same hue as its chip in the scores table and its series in every
  // chart. Only entities scored "mentioned" are candidates — the rest cannot
  // match anyway, and skipping them keeps the scan short.
  const highlights = useMemo<HighlightEntity[]>(
    () =>
      (data?.scores ?? [])
        .map((score, index) => ({
          name: score.name,
          color: seriesColor(index),
          domain: score.domains[0],
          domains: score.domains,
          aliases: score.aliases,
          mentioned: score.mentioned,
        }))
        .filter((e) => e.mentioned),
    [data?.scores],
  );
  const rehypePlugins = useMemo(
    () => [rehypeHighlightEntities(highlights)],
    [highlights],
  );

  return (
    <SidePane
      label="prompt run"
      title={
        <p className="text-[14px] text-primary">
          {data?.result.promptText ?? '…'}
        </p>
      }
      onClose={onClose}
      onCloseStart={onCloseStart}
      nested={nested}
    >
      {error ? <p className="text-[13px] text-error">{error}</p> : null}
      {loading || !data ? (
        <p className="font-mono text-[12px] text-muted">loading…</p>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="neutral">
              <SurfaceLogo
                surface={data.result.surface}
                className="mr-1.5 h-3 w-3 shrink-0"
              />
              {surfaceLabel(data.result.surface)}
            </Badge>
            <Badge tone="neutral">sample {data.result.sample}</Badge>
            {data.result.ok ? (
              data.result.answerPresent ? (
                <Badge tone="ok">ok</Badge>
              ) : (
                <Badge tone="neutral">no AIO</Badge>
              )
            ) : (
              <Badge tone="fail">failed</Badge>
            )}
            <span className="ml-auto font-mono text-[11px] text-muted">
              {data.result.durationMs !== null
                ? `${(data.result.durationMs / 1000).toFixed(1)}s · `
                : ''}
              {timestamp(data.result.createdAt)}
            </span>
          </div>

          {data.result.error ? (
            <p className="text-[13px] text-error">{data.result.error}</p>
          ) : null}

          <section>
            <SectionLabel>entity scores</SectionLabel>
            <table className="mt-2 w-full border-collapse text-[13px]">
              {/* Names the glyph columns once — a bare +/·/− mark or #rank is
                  not self-describing without it. */}
              <thead>
                <tr className="border-border border-b">
                  <th className="section-label pb-1.5 text-left font-normal">
                    entity
                  </th>
                  <th className="section-label pb-1.5 text-left font-normal">
                    signals
                  </th>
                  <th className="section-label pr-2 pb-1.5 text-right font-normal">
                    sentiment
                  </th>
                  <th className="section-label pb-1.5 text-right font-normal">
                    position
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.scores.map((score, index) => (
                  <tr
                    key={score.name}
                    className="border-border border-t first:border-t-0"
                  >
                    <td className="py-1.5 pr-2">
                      <EntityChip name={score.name} sortIndex={index} />
                    </td>
                    <td className="py-1.5 pr-2">
                      <span className="inline-flex gap-1">
                        {score.mentioned ? (
                          <Badge tone="ok">mentioned</Badge>
                        ) : null}
                        {score.cited ? <Badge tone="info">cited</Badge> : null}
                        {!score.mentioned && !score.cited ? (
                          <Badge tone="neutral">---</Badge>
                        ) : null}
                      </span>
                    </td>
                    {/* Own cell so the tags align into a scannable column. */}
                    <td className="py-1.5 pr-2 text-right">
                      {score.mentioned ? (
                        score.sentiment ? (
                          <SentimentTag sentiment={score.sentiment} />
                        ) : (
                          <Tooltip
                            asChild
                            content="sentiment not yet classified"
                            className="border-border-strong bg-bg-elevated text-primary shadow-lg"
                          >
                            <span className="font-mono text-[12px] text-muted">
                              —
                            </span>
                          </Tooltip>
                        )
                      ) : null}
                    </td>
                    <td className="py-1.5 text-right font-mono">
                      {fmtPosition(score.position)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section>
            <SectionLabel>response</SectionLabel>
            {data.answerText ? (
              <div className="md-body mt-2 max-h-96 overflow-y-auto border border-border bg-bg p-3">
                <Markdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={rehypePlugins}
                  components={{
                    mark: ({ node, children }) => (
                      <EntityMark node={node}>{children}</EntityMark>
                    ),
                    a: ({ node: _n, ...props }) => (
                      <a
                        {...props}
                        target="_blank"
                        rel="noreferrer nofollow"
                        className="text-primary underline"
                      />
                    ),
                    img: ({ alt }) => (
                      <span className="font-mono text-[11px] text-muted">
                        [image: {alt || 'untitled'}]
                      </span>
                    ),
                  }}
                >
                  {data.answerText}
                </Markdown>
              </div>
            ) : (
              <p className="mt-2 font-mono text-[12px] text-muted">
                no stored response text
                {data.result.hasRaw ? '' : ' (no raw payload)'}
              </p>
            )}
          </section>

          <section>
            <SectionLabel>citations · {data.citations.length}</SectionLabel>
            {data.citations.length === 0 ? (
              <p className="mt-2 font-mono text-[12px] text-muted">none</p>
            ) : (
              <CitationTable key={data.result.id} citations={data.citations} />
            )}
          </section>

          {/* Debugging aid, not a product feature: the provider envelope means
              nothing to an end user, and everything readable in it is already
              rendered above. Vite folds this branch away in a prod build. */}
          {import.meta.env.DEV && data.result.hasRaw ? (
            <a
              href={apiPath(`/runs/${runId}/results/${data.result.id}/raw`)}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[12px] text-secondary hover:text-primary"
            >
              view raw payload ↗
            </a>
          ) : null}
        </div>
      )}
    </SidePane>
  );
};
