import { Bar } from '@/components/dither-kit/bar';
import { BarChart } from '@/components/dither-kit/bar-chart';
import { Grid } from '@/components/dither-kit/grid';
import { XAxis } from '@/components/dither-kit/x-axis';
import { LandingContainer, LandingInset, SectionLabel } from './chrome';
import { ChartReveal, useCountUp, useInViewOnce } from './motion';
import { SignalChart } from './SignalChart';

const VISIBILITY_TREND = [31, 34, 41, 39, 47, 51, 58, 55, 63, 61].map(
  (visibility, i) => ({ period: i + 1, visibility }),
);

const SURFACE_VISIBILITY = [
  { surface: 'GPT', visibility: 74 },
  { surface: 'PPLX', visibility: 66 },
  { surface: 'GEM', visibility: 58 },
  { surface: 'MODE', visibility: 49 },
  { surface: 'AIO', visibility: 41 },
];

const STATS = [
  { label: 'mention rate', value: 61.4, delta: '+8.2 pp' },
  { label: 'citation rate', value: 34.8, delta: '+3.1 pp' },
  { label: 'share of voice', value: 28.6, delta: '+5.4 pp' },
];

const StatValue = ({ value, active }: { value: number; active: boolean }) => {
  const shown = useCountUp(value, active);
  return <>{shown.toFixed(1)}%</>;
};

const ProductPreview = () => {
  const [statsRef, statsInView] = useInViewOnce<HTMLDivElement>(0.4);

  return (
    <figure className="relative border-border border-y bg-bg-elevated shadow-[0_36px_100px_var(--color-shadow)]">
      <figcaption className="sr-only">
        A sample refd overview showing AI search visibility metrics and prompt
        performance.
      </figcaption>
      <div className="flex h-12 items-center justify-between border-border border-b px-4 sm:px-5">
        <div className="flex items-center gap-3">
          <span className="landing-live-dot h-1.5 w-1.5 bg-accent" />
          <span className="font-mono text-[10px] text-primary uppercase tracking-[0.12em]">
            visibility overview
          </span>
        </div>
        <span className="font-mono text-[10px] text-muted uppercase tracking-[0.08em]">
          last 30 days
        </span>
      </div>
      <div
        ref={statsRef}
        className="grid border-border border-b sm:grid-cols-3"
      >
        {STATS.map(({ label, value, delta }, i) => (
          <div
            key={label}
            className={`p-4 sm:p-5 ${i > 0 ? 'border-border border-t sm:border-t-0 sm:border-l' : ''}`}
          >
            <p className="font-mono text-[10px] text-muted uppercase tracking-[0.12em]">
              {label}
            </p>
            <div className="mt-3 flex items-end justify-between gap-3">
              <strong className="font-mono font-normal text-[24px] text-primary sm:text-[28px]">
                <StatValue value={value} active={statsInView} />
              </strong>
              <span className="mb-1 font-mono text-[10px] text-primary">
                {delta}
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className="grid lg:grid-cols-[2fr_1fr]">
        <div className="border-border p-4 sm:p-5 lg:border-r">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="font-mono text-[10px] text-muted uppercase tracking-[0.12em]">
                brand visibility
              </p>
              <p className="mt-1 text-[13px] text-secondary">
                Across all tracked answers
              </p>
            </div>
            <div className="flex items-center gap-2 font-mono text-[10px] text-muted">
              <span className="h-1.5 w-1.5 bg-accent" /> your brand
            </div>
          </div>
          <div className="h-[180px] sm:h-[210px]">
            <ChartReveal variant="sweep">
              <SignalChart data={VISIBILITY_TREND} />
            </ChartReveal>
          </div>
        </div>
        <div className="p-4 sm:p-5">
          <p className="font-mono text-[10px] text-muted uppercase tracking-[0.12em]">
            by surface
          </p>
          <div className="mt-4 h-[210px]">
            <ChartReveal variant="rise">
              <BarChart
                data={SURFACE_VISIBILITY}
                config={{ visibility: { label: 'visibility', color: 'red' } }}
                interactive={false}
                bloom="off"
                margins={{ top: 8, right: 8, bottom: 28, left: 8 }}
                className="h-full w-full"
              >
                <Grid />
                <XAxis dataKey="surface" maxTicks={5} tickMargin={6} />
                <Bar dataKey="visibility" />
              </BarChart>
            </ChartReveal>
          </div>
        </div>
      </div>
      <div className="hidden border-border border-t px-5 py-3 sm:grid sm:grid-cols-[1fr_120px_100px] sm:gap-4">
        <span className="font-mono text-[10px] text-muted uppercase tracking-[0.12em]">
          prompt
        </span>
        <span className="font-mono text-[10px] text-muted uppercase tracking-[0.12em]">
          mentioned
        </span>
        <span className="font-mono text-[10px] text-muted uppercase tracking-[0.12em]">
          position
        </span>
      </div>
      {[
        ['Best platforms for distributed teams', 'yes', '#1'],
        ['How to monitor brand visibility in AI', 'yes', '#2'],
        ['AI search tools for growing companies', 'no', '—'],
      ].map(([prompt, mentioned, position]) => (
        <div
          key={prompt}
          className="hidden border-border border-t px-5 py-3 text-[12px] sm:grid sm:grid-cols-[1fr_120px_100px] sm:gap-4"
        >
          <span className="truncate text-secondary">{prompt}</span>
          <span className={mentioned === 'yes' ? 'text-primary' : 'text-muted'}>
            {mentioned}
          </span>
          <span className="font-mono text-primary">{position}</span>
        </div>
      ))}
    </figure>
  );
};

export const PlatformSection = () => (
  <section
    id="platform"
    className="scroll-mt-14 border-border border-b md:scroll-mt-[68px]"
  >
    <LandingContainer className="py-16 sm:py-24">
      <LandingInset className="grid items-end gap-8 lg:grid-cols-[1fr_0.7fr]">
        <div>
          <SectionLabel>01 / the platform</SectionLabel>
          <h2 className="mt-5 max-w-[680px] text-[34px] leading-[1.08] tracking-[-0.04em] sm:text-[52px]">
            Your AI search performance, with the receipts.
          </h2>
        </div>
        <p className="max-w-[450px] text-[14px] text-secondary leading-[1.75] lg:justify-self-end">
          See visibility, citations, position, and share of voice in one place.
          Then move from any metric to the prompt and raw answer behind it.
        </p>
      </LandingInset>
      <div className="relative mt-10 sm:mt-12">
        <div
          aria-hidden
          className="absolute -inset-x-24 -inset-y-32 bg-[radial-gradient(ellipse_50%_50%_at_center,rgba(240,43,58,0.12)_0%,rgba(240,43,58,0.05)_48%,transparent_100%)] blur-2xl"
        />
        <ProductPreview />
      </div>
    </LandingContainer>
  </section>
);
