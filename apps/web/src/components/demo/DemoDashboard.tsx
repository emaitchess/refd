import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { DitherIcon } from '@/components/dither/DitherIcon';
import { Area, Line } from '@/components/dither-kit/area';
import { AreaChart, LineChart } from '@/components/dither-kit/area-chart';
import { Bar } from '@/components/dither-kit/bar';
import { BarChart } from '@/components/dither-kit/bar-chart';
import { Dot } from '@/components/dither-kit/dot';
import { DitherGradient } from '@/components/dither-kit/gradient';
import { Grid } from '@/components/dither-kit/grid';
import { Legend } from '@/components/dither-kit/legend';
import { Radar } from '@/components/dither-kit/radar';
import { RadarChart } from '@/components/dither-kit/radar-chart';
import { Sparkline } from '@/components/dither-kit/sparkline';
import { ChartTooltip } from '@/components/dither-kit/tooltip';
import { XAxis } from '@/components/dither-kit/x-axis';
import { YAxis } from '@/components/dither-kit/y-axis';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { ChartCard } from '@/components/ui/ChartCard';
import { SentimentTag } from '@/components/ui/SentimentTag';
import { StatTile } from '@/components/ui/StatTile';
import { BRANDED_THEME_TOKENS } from '@/lib/branded-theme';
import { useTheme } from '@/lib/theme';
import { CREATE_ACCOUNT_URL } from '../../consts';
import { LandingContainer, LandingInset } from '../landing/chrome';
import {
  DEMO_PROMPTS,
  DEMO_RANGE_DATA,
  DEMO_RANGE_ORDER,
  DEMO_SURFACES,
  type DemoPromptResult,
  type DemoRange,
  type DemoSurface,
} from './demo-data';

const ENTITY_CONFIG = {
  ultrahuman: { label: 'Ultrahuman', color: 'green' },
  oura: { label: 'Oura', color: 'purple' },
  whoop: { label: 'WHOOP', color: 'red' },
  ringconn: { label: 'RingConn', color: 'blue' },
} as const;

const SOV_CONFIG = {
  sovUltrahuman: { label: 'Ultrahuman', color: 'green' },
  sovOura: { label: 'Oura', color: 'purple' },
  sovWhoop: { label: 'WHOOP', color: 'red' },
  sovRingconn: { label: 'RingConn', color: 'blue' },
} as const;

const SURFACE_CONFIG = {
  ultrahuman: { label: 'mentioned', color: 'green' },
  citation: { label: 'cited', color: 'blue' },
} as const;

const SURFACE_TAB_LABELS: Record<DemoSurface, string> = {
  ChatGPT: 'ChatGPT',
  Perplexity: 'Perplexity',
  Gemini: 'Gemini',
  'Google AI Mode': 'AI Mode',
  'Google AI Overviews': 'AI Overviews',
};

const pct = (value: number) => `${value.toFixed(1)}%`;
const position = (value: number | null) =>
  value == null ? '—' : `#${value.toFixed(1)}`;
const delta = (value: number) =>
  `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}${value === 0 ? '' : ' pp'}`;

const MetricSpark = ({
  data,
  hint,
  reverse = false,
}: {
  data: number[];
  hint: string;
  reverse?: boolean;
}) => (
  <div className="mt-auto flex items-end justify-between gap-3">
    <p className="font-mono text-[10px] text-muted leading-relaxed">{hint}</p>
    <Sparkline
      data={reverse ? data.map((value) => -value) : data}
      color="green"
      bloom="off"
      className="h-8 w-24 shrink-0"
    />
  </div>
);

const DemoTile = ({
  label,
  value,
  change,
  good,
  spark,
  hint,
  reverseSpark = false,
}: {
  label: string;
  value: string;
  change: string;
  good: boolean;
  spark: number[];
  hint: string;
  reverseSpark?: boolean;
}) => (
  <StatTile
    label={label}
    value={value}
    delta={change}
    deltaGood={good}
    spark={<MetricSpark data={spark} hint={hint} reverse={reverseSpark} />}
    className="min-h-[142px] border-0 bg-bg-elevated"
  />
);

const ResultSignal = ({
  yes,
  yesLabel,
  noLabel,
}: {
  yes: boolean;
  yesLabel: string;
  noLabel: string;
}) => <Badge tone={yes ? 'ok' : 'neutral'}>{yes ? yesLabel : noLabel}</Badge>;

const PromptRow = ({
  result,
  selected,
  onSelect,
}: {
  result: DemoPromptResult;
  selected: boolean;
  onSelect: () => void;
}) => (
  <button
    type="button"
    onClick={onSelect}
    aria-pressed={selected}
    className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-border border-t px-4 py-3 text-left transition-colors duration-150 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_135px_92px_76px_28px] sm:px-5 ${
      selected ? 'bg-accent-soft' : 'hover:bg-bg-card-hover'
    }`}
  >
    <span className="min-w-0">
      <span className="block truncate text-[13px] text-primary">
        {result.prompt}
      </span>
      <span className="mt-1 block font-mono text-[10px] text-muted uppercase tracking-[0.08em] sm:hidden">
        {result.surface} · {result.category}
      </span>
    </span>
    <span className="hidden font-mono text-[11px] text-secondary sm:block">
      {result.surface}
    </span>
    <span className="hidden sm:block">
      <ResultSignal
        yes={result.mentioned}
        yesLabel="mentioned"
        noLabel="absent"
      />
    </span>
    <span className="hidden font-mono text-[12px] text-primary sm:block">
      {position(result.position)}
    </span>
    <DitherIcon
      name="arrow-right"
      size={12}
      className={selected ? 'text-primary' : 'text-muted'}
    />
    <span className="flex items-center gap-2 sm:hidden">
      <ResultSignal
        yes={result.mentioned}
        yesLabel="mentioned"
        noLabel="absent"
      />
      <span className="font-mono text-[11px] text-primary">
        {position(result.position)}
      </span>
    </span>
  </button>
);

const EvidencePanel = ({ result }: { result: DemoPromptResult }) => (
  <section
    aria-labelledby="demo-evidence-title"
    className="border border-border bg-bg-card"
  >
    <header className="flex flex-wrap items-start justify-between gap-4 border-border border-b bg-bg-elevated px-5 py-4">
      <div className="max-w-[760px]">
        <p className="font-mono text-[10px] text-muted uppercase tracking-[0.12em]">
          answer evidence
        </p>
        <h3
          id="demo-evidence-title"
          className="mt-2 text-[16px] text-primary leading-snug"
        >
          {result.prompt}
        </h3>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral">{result.surface}</Badge>
        <ResultSignal
          yes={result.mentioned}
          yesLabel="mentioned"
          noLabel="absent"
        />
        <ResultSignal yes={result.cited} yesLabel="cited" noLabel="not cited" />
        <SentimentTag sentiment={result.sentiment} />
      </div>
    </header>
    <div className="grid lg:grid-cols-[minmax(0,1.65fr)_minmax(260px,0.75fr)]">
      <div className="border-border p-5 lg:border-r">
        <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[10px] text-muted uppercase tracking-[0.08em]">
          <span>sample 2 of 2</span>
          <span>position {position(result.position)}</span>
          <span>captured 28 Jul 2026</span>
        </div>
        <p className="text-[14px] text-secondary leading-[1.75]">
          {result.answer}
        </p>
        <div className="mt-5 border-border border-t pt-4">
          <p className="font-mono text-[10px] text-muted uppercase tracking-[0.1em]">
            why this matters
          </p>
          <p className="mt-2 text-[13px] text-primary leading-relaxed">
            {result.summary}
          </p>
        </div>
      </div>
      <aside className="p-5" aria-label="Citations in the selected answer">
        <p className="font-mono text-[10px] text-muted uppercase tracking-[0.12em]">
          cited sources
        </p>
        {result.citations.length > 0 ? (
          <div className="mt-3 border border-border">
            {result.citations.map((citation) => (
              <a
                key={`${result.id}-${citation.domain}`}
                href={citation.url}
                target="_blank"
                rel="noreferrer"
                className="group block border-border border-t p-3 first:border-t-0 hover:bg-bg-card-hover"
              >
                <span className="flex items-center justify-between gap-3 font-mono text-[11px] text-primary">
                  {citation.domain}
                  <span
                    aria-hidden
                    className="transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                  >
                    ↗
                  </span>
                </span>
                <span className="mt-1.5 block text-[12px] text-muted leading-relaxed">
                  {citation.note}
                </span>
              </a>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-[13px] text-muted">
            This answer did not include source links.
          </p>
        )}
      </aside>
    </div>
  </section>
);

export const DemoDashboard = () => {
  const [theme] = useTheme();
  const [range, setRange] = useState<DemoRange>('30d');
  const [surface, setSurface] = useState<'all' | DemoSurface>('all');
  const [selectedId, setSelectedId] = useState(DEMO_PROMPTS[0]?.id ?? '');
  const data = DEMO_RANGE_DATA[range];

  const filteredPrompts = useMemo(
    () =>
      surface === 'all'
        ? DEMO_PROMPTS
        : DEMO_PROMPTS.filter((prompt) => prompt.surface === surface),
    [surface],
  );

  useEffect(() => {
    if (!filteredPrompts.some((prompt) => prompt.id === selectedId)) {
      setSelectedId(filteredPrompts[0]?.id ?? '');
    }
  }, [filteredPrompts, selectedId]);

  const selected =
    filteredPrompts.find((prompt) => prompt.id === selectedId) ??
    filteredPrompts[0] ??
    DEMO_PROMPTS[0];

  return (
    <main
      className="landing-shell bg-bg text-primary"
      style={BRANDED_THEME_TOKENS[theme] as CSSProperties}
    >
      <section className="border-border border-b">
        <LandingContainer className="overflow-hidden">
          <DitherGradient
            from="grey"
            to="transparent"
            direction="right"
            cell={3}
            opacity={theme === 'dark' ? 0.16 : 0.08}
            bloom="off"
          />
          <LandingInset className="relative z-1 py-14 sm:py-18">
            <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-[700px]">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="border border-border-strong bg-bg/70 px-2.5 py-1 font-mono text-[10px] text-accent uppercase tracking-[0.14em]">
                    interactive sample
                  </span>
                  <span className="font-mono text-[10px] text-muted uppercase tracking-[0.1em]">
                    illustrative data · no sign-up
                  </span>
                </div>
                <div className="mt-7 flex items-center gap-4">
                  <span className="flex size-11 items-center justify-center border border-border-strong bg-bg-elevated font-mono text-[18px] text-primary">
                    U
                  </span>
                  <div>
                    <p className="font-mono text-[10px] text-muted uppercase tracking-[0.12em]">
                      sample workspace
                    </p>
                    <p className="mt-1 text-[14px] text-secondary">
                      ultrahuman.com
                    </p>
                  </div>
                </div>
                <h1 className="mt-7 max-w-[680px] text-balance font-[520] text-[38px] leading-[1.03] tracking-[-0.04em] sm:text-[56px]">
                  See Ultrahuman&apos;s AI search visibility.
                </h1>
                <p className="mt-5 max-w-[650px] text-[14px] text-secondary leading-[1.75] sm:text-[15px]">
                  Explore a realistic refd workspace across smart-ring buyer
                  questions. Change the time range, inspect every chart, filter
                  AI surfaces, and open the answer behind a metric.
                </p>
              </div>
              <fieldset className="shrink-0 border border-border bg-bg/70 p-1">
                <legend className="sr-only">Demo date range</legend>
                <div className="flex">
                  {DEMO_RANGE_ORDER.map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setRange(value)}
                      aria-pressed={range === value}
                      className={`h-9 min-w-14 px-3 font-mono text-[11px] transition-colors ${
                        range === value
                          ? 'bg-primary text-bg'
                          : 'text-muted hover:bg-bg-card-hover hover:text-primary'
                      }`}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>
          </LandingInset>
        </LandingContainer>
      </section>

      <section className="border-border border-b">
        <LandingContainer>
          <LandingInset className="py-10 sm:py-12">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] text-accent uppercase tracking-[0.14em]">
                  performance snapshot
                </p>
                <p className="mt-2 text-[13px] text-muted">
                  {data.label} · {data.runCount} runs · {data.answerCount}{' '}
                  answers
                </p>
              </div>
              <p className="font-mono text-[10px] text-muted uppercase tracking-[0.08em]">
                updated 28 Jul 2026
              </p>
            </div>
            <div className="overflow-hidden border border-border">
              <div className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2 xl:grid-cols-4">
                <DemoTile
                  label="Mention rate"
                  value={pct(data.tiles.mention.value)}
                  change={delta(data.tiles.mention.delta)}
                  good={data.tiles.mention.delta >= 0}
                  spark={data.tiles.mention.spark}
                  hint={`${data.answerCount} scored answers`}
                />
                <DemoTile
                  label="Share of voice"
                  value={pct(data.tiles.sov.value)}
                  change={delta(data.tiles.sov.delta)}
                  good={data.tiles.sov.delta >= 0}
                  spark={data.tiles.sov.spark}
                  hint="within the tracked set"
                />
                <DemoTile
                  label="Avg position"
                  value={position(data.tiles.position.value)}
                  change={`${data.tiles.position.delta <= 0 ? '↑' : '↓'} ${Math.abs(data.tiles.position.delta).toFixed(1)}`}
                  good={data.tiles.position.delta <= 0}
                  spark={data.tiles.position.spark}
                  hint="when Ultrahuman appears"
                  reverseSpark
                />
                <DemoTile
                  label="Citation rate"
                  value={pct(data.tiles.citation.value)}
                  change={delta(data.tiles.citation.delta)}
                  good={data.tiles.citation.delta >= 0}
                  spark={data.tiles.citation.spark}
                  hint="brand domain cited"
                />
              </div>
              <div className="flex flex-col gap-3 border-border border-t bg-bg-elevated px-5 py-4 sm:flex-row sm:items-start">
                <DitherIcon
                  name="overview"
                  size={14}
                  className="mt-0.5 shrink-0 text-success"
                />
                <div>
                  <p className="text-[14px] text-primary">
                    {data.change.title}
                  </p>
                  <p className="mt-1 text-[13px] text-secondary leading-relaxed">
                    {data.change.body}
                  </p>
                  <p className="mt-2 font-mono text-[10px] text-muted leading-relaxed">
                    {data.change.detail}
                  </p>
                </div>
              </div>
            </div>
          </LandingInset>
        </LandingContainer>
      </section>

      <section className="border-border border-b">
        <LandingContainer>
          <LandingInset className="py-10 sm:py-12">
            <div className="mb-5">
              <p className="font-mono text-[10px] text-accent uppercase tracking-[0.14em]">
                trends and breakdowns
              </p>
              <h2 className="mt-3 text-[24px] tracking-[-0.025em] sm:text-[28px]">
                Where Ultrahuman appears, and who appears instead.
              </h2>
              <p className="mt-2 text-[13px] text-muted">
                Hover charts for exact values. Select a legend item to isolate
                one entity.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <ChartCard
                title={`mention rate % · per run · ${data.label}`}
                className="xl:col-span-2"
              >
                <AreaChart
                  data={data.trend}
                  config={ENTITY_CONFIG}
                  bloom="low"
                  margins={{ top: 34 }}
                  className="h-72 w-full sm:h-80"
                >
                  <Grid />
                  <XAxis dataKey="period" />
                  <YAxis tickFormatter={(value) => `${Math.round(value)}%`} />
                  <Area dataKey="ultrahuman" variant="gradient" isClickable>
                    <Dot variant="colored-border" r={2} />
                  </Area>
                  <Line dataKey="oura" isClickable />
                  <Line dataKey="whoop" isClickable />
                  <Line dataKey="ringconn" isClickable />
                  <Legend isClickable />
                  <ChartTooltip />
                </AreaChart>
              </ChartCard>

              <ChartCard
                title={`mentioned vs cited % · by surface · ${data.label}`}
              >
                <BarChart
                  data={data.surfaces}
                  config={SURFACE_CONFIG}
                  bloom="off"
                  margins={{ top: 34 }}
                  className="h-64 w-full"
                >
                  <Grid />
                  <XAxis dataKey="surface" maxTicks={5} />
                  <YAxis tickFormatter={(value) => `${Math.round(value)}%`} />
                  <Bar dataKey="ultrahuman" isClickable />
                  <Bar dataKey="citation" isClickable />
                  <Legend isClickable />
                  <ChartTooltip />
                </BarChart>
              </ChartCard>

              <ChartCard title={`share of voice % · per run · ${data.label}`}>
                <LineChart
                  data={data.trend}
                  config={SOV_CONFIG}
                  margins={{ top: 34 }}
                  className="h-64 w-full"
                >
                  <Grid />
                  <XAxis dataKey="period" />
                  <YAxis tickFormatter={(value) => `${Math.round(value)}%`} />
                  <Line dataKey="sovUltrahuman" isClickable />
                  <Line dataKey="sovOura" isClickable />
                  <Line dataKey="sovWhoop" isClickable />
                  <Line dataKey="sovRingconn" isClickable />
                  <Legend isClickable />
                  <ChartTooltip />
                </LineChart>
              </ChartCard>

              <ChartCard
                title={`competitive profile · mention rate % · ${data.label}`}
              >
                <RadarChart
                  data={data.surfaces}
                  config={ENTITY_CONFIG}
                  nameKey="surface"
                  bloom="low"
                  margins={{ top: 38, right: 28, bottom: 20, left: 28 }}
                  className="h-72 w-full"
                >
                  <Radar dataKey="ultrahuman" variant="gradient" />
                  <Radar dataKey="oura" variant="dotted" />
                  <Radar dataKey="whoop" variant="dotted" />
                  <Radar dataKey="ringconn" variant="dotted" />
                  <Legend isClickable />
                </RadarChart>
              </ChartCard>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <ChartCard title={`brand prominence · ${data.label}`}>
                  <BarChart
                    data={data.prominence}
                    config={{ share: { label: 'share', color: 'green' } }}
                    bloom="off"
                    className="h-56 w-full"
                  >
                    <Grid />
                    <XAxis dataKey="tier" maxTicks={3} />
                    <YAxis tickFormatter={(value) => `${Math.round(value)}%`} />
                    <Bar dataKey="share" />
                    <ChartTooltip />
                  </BarChart>
                </ChartCard>
                <ChartCard title={`brand sentiment · ${data.label}`}>
                  <BarChart
                    data={data.sentiment}
                    config={{ share: { label: 'share', color: 'green' } }}
                    bloom="off"
                    className="h-56 w-full"
                  >
                    <Grid />
                    <XAxis dataKey="stance" maxTicks={3} />
                    <YAxis tickFormatter={(value) => `${Math.round(value)}%`} />
                    <Bar dataKey="share" />
                    <ChartTooltip />
                  </BarChart>
                </ChartCard>
              </div>
            </div>
          </LandingInset>
        </LandingContainer>
      </section>

      <section className="border-border border-b">
        <LandingContainer>
          <LandingInset className="py-10 sm:py-12">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="font-mono text-[10px] text-accent uppercase tracking-[0.14em]">
                  prompt-level results
                </p>
                <h2 className="mt-3 text-[24px] tracking-[-0.025em] sm:text-[28px]">
                  Open the evidence behind the score.
                </h2>
                <p className="mt-2 max-w-[620px] text-[13px] text-muted leading-relaxed">
                  Filter by AI surface, then select a buyer question to inspect
                  the answer, position, sentiment, and cited domains.
                </p>
              </div>
              <div
                role="tablist"
                aria-label="Filter demo results by AI surface"
                className="flex max-w-full overflow-x-auto border border-border bg-bg-elevated p-1"
              >
                {(['all', ...DEMO_SURFACES] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={surface === value}
                    onClick={() => setSurface(value)}
                    className={`h-8 shrink-0 px-3 font-mono text-[10px] transition-colors ${
                      surface === value
                        ? 'bg-primary text-bg'
                        : 'text-muted hover:bg-bg-card-hover hover:text-primary'
                    }`}
                  >
                    {value === 'all' ? 'All' : SURFACE_TAB_LABELS[value]}
                  </button>
                ))}
              </div>
            </div>

            <Card className="mt-5 overflow-hidden p-0">
              <div className="hidden grid-cols-[minmax(0,1fr)_135px_92px_76px_28px] gap-4 border-border border-b bg-bg-elevated px-5 py-3 font-mono text-[10px] text-muted uppercase tracking-[0.1em] sm:grid">
                <span>buyer question</span>
                <span>surface</span>
                <span>visibility</span>
                <span>position</span>
                <span aria-hidden />
              </div>
              {filteredPrompts.map((result) => (
                <PromptRow
                  key={result.id}
                  result={result}
                  selected={result.id === selected?.id}
                  onSelect={() => setSelectedId(result.id)}
                />
              ))}
            </Card>

            {selected ? (
              <div className="mt-4">
                <EvidencePanel result={selected} />
              </div>
            ) : null}
          </LandingInset>
        </LandingContainer>
      </section>

      <section className="border-border border-b">
        <LandingContainer className="overflow-hidden">
          <DitherGradient
            from="red"
            to="transparent"
            direction="up"
            cell={3}
            opacity={theme === 'dark' ? 0.18 : 0.1}
            bloom="off"
          />
          <LandingInset className="relative z-1 flex flex-col items-start justify-between gap-6 py-12 sm:flex-row sm:items-center">
            <div className="max-w-[650px]">
              <p className="font-mono text-[10px] text-accent uppercase tracking-[0.14em]">
                monitor your brand
              </p>
              <h2 className="mt-3 text-[28px] leading-tight tracking-[-0.03em] sm:text-[34px]">
                Replace sample data with your own buyer questions.
              </h2>
              <p className="mt-3 text-[13px] text-secondary leading-relaxed">
                Create a workspace, confirm your competitors, and inspect the
                real AI answers behind every metric.
              </p>
            </div>
            <a
              href={CREATE_ACCOUNT_URL}
              className="btn-primary h-10 shrink-0 px-5"
            >
              start monitoring
            </a>
          </LandingInset>
        </LandingContainer>
      </section>

      <section aria-label="Demo data disclaimer">
        <LandingContainer>
          <LandingInset className="py-6">
            <p className="font-mono text-[10px] text-muted leading-relaxed">
              This is fabricated demonstration data for a hypothetical
              Ultrahuman workspace. It is not live monitoring, and refd is not
              affiliated with or endorsed by Ultrahuman.
            </p>
          </LandingInset>
        </LandingContainer>
      </section>
    </main>
  );
};
