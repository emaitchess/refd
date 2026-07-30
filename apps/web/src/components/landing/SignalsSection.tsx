import {
  DitherIcon,
  type DitherIconName,
} from '@/components/dither/DitherIcon';
import { Area } from '@/components/dither-kit/area';
import { AreaChart } from '@/components/dither-kit/area-chart';
import { Bar } from '@/components/dither-kit/bar';
import { BarChart } from '@/components/dither-kit/bar-chart';
import { Dot } from '@/components/dither-kit/dot';
import { Grid } from '@/components/dither-kit/grid';
import { Radar } from '@/components/dither-kit/radar';
import { RadarChart } from '@/components/dither-kit/radar-chart';
import { XAxis } from '@/components/dither-kit/x-axis';
import { LandingContainer, LandingInset, SectionLabel } from './chrome';
import { ChartReveal } from './motion';

const GRAPHIC_REVEALS = ['sweep', 'rise', 'zoom'] as const;

const SIGNAL_VISIBILITY_TREND = [46, 40, 35, 38, 49, 58, 67, 61, 52, 45].map(
  (visibility, i) => ({ period: i + 1, visibility }),
);

const POSITION_BENCHMARK = [
  { rank: '01', position: 82 },
  { rank: '02', position: 64 },
  { rank: '03', position: 43 },
];

const AUTHORITY_PROFILE = [
  { source: 'docs', authority: 86 },
  { source: 'press', authority: 61 },
  { source: 'reviews', authority: 72 },
  { source: 'forums', authority: 47 },
  { source: 'partners', authority: 66 },
];

const SIGNALS: {
  icon: DitherIconName;
  eyebrow: string;
  title: string;
  body: string;
}[] = [
  {
    icon: 'overview',
    eyebrow: 'visibility',
    title: 'Track where you show up.',
    body: 'Measure mention rate and share of voice across the questions that shape how buyers discover products.',
  },
  {
    icon: 'competitors',
    eyebrow: 'position',
    title: 'See who owns the answer.',
    body: 'Compare first-mention position and prominence with the competitors that matter in your market.',
  },
  {
    icon: 'sources',
    eyebrow: 'authority',
    title: 'Learn which sources AI trusts.',
    body: 'Separate mentions from citations and uncover the domains shaping answers where your brand is absent.',
  },
];

const SignalGraphic = ({ index }: { index: number }) => {
  if (index === 0) {
    return (
      <AreaChart
        data={SIGNAL_VISIBILITY_TREND}
        config={{ visibility: { label: 'visibility', color: 'red' } }}
        interactive={false}
        markerIndex={SIGNAL_VISIBILITY_TREND.length - 1}
        bloom="low"
        margins={{ top: 8, right: 0, bottom: 0, left: 0 }}
        className="h-full w-full"
      >
        <Grid />
        <Area dataKey="visibility" variant="gradient">
          <Dot variant="colored-border" r={2} />
        </Area>
      </AreaChart>
    );
  }

  if (index === 1) {
    return (
      <BarChart
        data={POSITION_BENCHMARK}
        config={{ position: { label: 'position', color: 'red' } }}
        interactive={false}
        bloom="off"
        margins={{ top: 8, right: 8, bottom: 24, left: 8 }}
        className="h-full w-full"
      >
        <Grid />
        <XAxis dataKey="rank" maxTicks={3} tickMargin={6} />
        <Bar dataKey="position" />
      </BarChart>
    );
  }

  return (
    <RadarChart
      data={AUTHORITY_PROFILE}
      config={{ authority: { label: 'authority', color: 'red' } }}
      nameKey="source"
      bloom="low"
      margins={{ top: 18, right: 28, bottom: 18, left: 28 }}
      className="h-full w-full"
    >
      <Radar dataKey="authority" variant="gradient" />
    </RadarChart>
  );
};

export const SignalsSection = () => (
  <section
    id="signals"
    className="border-border border-b"
    style={{ scrollMarginTop: 'var(--public-header-height, 56px)' }}
  >
    <LandingContainer className="py-16 sm:py-24">
      <LandingInset>
        <div className="max-w-[700px]">
          <SectionLabel>02 / the signals</SectionLabel>
          <h2 className="mt-5 text-[34px] leading-[1.08] tracking-[-0.04em] sm:text-[52px]">
            Understand how AI search sees your brand.
          </h2>
          <p className="mt-5 max-w-[590px] text-[14px] text-secondary leading-[1.75]">
            Measure the signals that reveal whether you are being found, how you
            compare, and which sources influence the result.
          </p>
        </div>
      </LandingInset>
      <div className="relative mt-10 grid border-border border-t sm:mt-12 lg:grid-cols-3">
        {SIGNALS.map((signal, i) => (
          <article
            key={signal.title}
            className={`group grid grid-rows-2 border-border border-b bg-bg-elevated ${i < SIGNALS.length - 1 ? 'lg:border-r' : ''}`}
          >
            <div className="min-h-[180px] border-border border-b p-4">
              <ChartReveal variant={GRAPHIC_REVEALS[i] ?? 'sweep'}>
                <SignalGraphic index={i} />
              </ChartReveal>
            </div>
            <div className="p-6 sm:p-7">
              <div className="flex items-center gap-3">
                <DitherIcon
                  name={signal.icon}
                  size={14}
                  className="text-accent"
                />
                <span className="font-mono text-[10px] text-accent uppercase tracking-[0.14em]">
                  {signal.eyebrow}
                </span>
              </div>
              <h3 className="mt-6 text-[22px] leading-[1.2] tracking-tight">
                {signal.title}
              </h3>
              <p className="mt-4 text-[14px] text-secondary leading-[1.7]">
                {signal.body}
              </p>
            </div>
          </article>
        ))}
      </div>
    </LandingContainer>
  </section>
);
