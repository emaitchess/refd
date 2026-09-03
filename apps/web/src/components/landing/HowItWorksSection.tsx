import type { CSSProperties } from 'react';
import { DitherIcon } from '@/components/dither/DitherIcon';
import { SurfaceLogo } from '@/components/svgs/SurfaceLogo';
import { SURFACE_ORDER, surfaceLabel } from '@/lib/format';
import { LandingContainer, LandingInset, SectionLabel } from './chrome';
import { ChartReveal, useInViewOnce } from './motion';
import { SignalChart } from './SignalChart';

const DURABLE_TREND = [38, 43, 41, 47, 45, 53, 51, 58, 61, 64].map(
  (visibility, i) => ({ period: i + 1, visibility }),
);

const stagger = (i: number) => ({ '--stagger': i }) as CSSProperties;

const HowItWorksIllustration = () => {
  const [ref, inView] = useInViewOnce<HTMLElement>(0.25);

  return (
    <figure
      ref={ref}
      data-cascade-in={inView}
      className="border border-border bg-bg-elevated shadow-[0_24px_70px_var(--color-shadow)]"
    >
      <figcaption className="sr-only">
        A monitoring run moves a prompt set across five AI surfaces, preserves
        every answer, and turns scheduled observations into a durable visibility
        trend.
      </figcaption>
      <div
        className="landing-cascade-item flex h-12 items-center justify-between border-border border-b px-5"
        style={stagger(0)}
      >
        <span className="flex items-center gap-3 font-mono text-[10px] text-primary uppercase tracking-[0.12em]">
          <span className="landing-live-dot size-1.5 bg-accent" /> monitoring
          run
        </span>
        <span className="font-mono text-[10px] text-accent uppercase tracking-widest">
          verified
        </span>
      </div>

      <div
        className="landing-cascade-item grid grid-cols-[92px_1fr] border-border border-b sm:grid-cols-[112px_1fr]"
        style={stagger(1)}
      >
        <div className="flex items-center border-border border-r px-4 py-5 font-mono text-[10px] text-muted uppercase tracking-widest">
          input
        </div>
        <div className="flex items-center justify-between gap-4 px-5 py-5">
          <div className="flex items-center gap-3">
            <DitherIcon name="prompts" size={16} className="text-accent" />
            <span className="text-[14px] text-primary">prompt set</span>
          </div>
          <span className="font-mono text-[12px] text-secondary">
            30 questions
          </span>
        </div>
      </div>

      <div
        className="landing-cascade-item grid grid-cols-[92px_1fr] border-border border-b sm:grid-cols-[112px_1fr]"
        style={stagger(2)}
      >
        <div className="flex items-center border-border border-r px-4 py-5 font-mono text-[10px] text-muted uppercase tracking-widest">
          sample
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-5">
          {SURFACE_ORDER.map((surface) => (
            <span
              key={surface}
              className="flex items-center gap-2 text-secondary"
            >
              <SurfaceLogo surface={surface} className="size-4" />
              <span className="sr-only">{surfaceLabel(surface)}</span>
            </span>
          ))}
        </div>
      </div>

      <div
        className="landing-cascade-item grid grid-cols-[92px_1fr] border-border border-b sm:grid-cols-[112px_1fr]"
        style={stagger(3)}
      >
        <div className="flex items-center border-border border-r px-4 py-5 font-mono text-[10px] text-muted uppercase tracking-widest">
          output
        </div>
        <div className="flex items-center justify-between gap-4 px-5 py-5">
          <div className="flex items-center gap-3">
            <DitherIcon name="overview" size={16} className="text-accent" />
            <span className="text-[14px] text-primary">raw answers</span>
          </div>
          <span className="font-mono text-[12px] text-secondary">
            preserved
          </span>
        </div>
      </div>

      <div className="landing-cascade-item p-5 sm:p-6" style={stagger(4)}>
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] text-muted uppercase tracking-[0.12em]">
              durable signal
            </p>
            <p className="mt-1 text-[13px] text-secondary">
              Scheduled observations over time
            </p>
          </div>
          <span className="font-mono text-[10px] text-primary">+6.4 pp</span>
        </div>
        <div className="h-[180px] sm:h-[210px]">
          <ChartReveal variant="sweep">
            <SignalChart data={DURABLE_TREND} />
          </ChartReveal>
        </div>
      </div>
    </figure>
  );
};

export const HowItWorksSection = () => {
  const [stepsRef, stepsInView] = useInViewOnce<HTMLOListElement>(0.3);

  return (
    <section className="border-border border-b">
      <LandingContainer className="py-16 sm:py-24">
        <LandingInset className="grid gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-16">
          <div className="order-2 lg:order-1">
            <HowItWorksIllustration />
          </div>
          <div className="order-1 lg:order-2">
            <SectionLabel>03 / how it works</SectionLabel>
            <h2 className="mt-5 text-[34px] leading-[1.08] tracking-[-0.04em] sm:text-[46px]">
              Track the questions that matter. Verify every answer.
            </h2>
            <p className="mt-5 max-w-[590px] text-[15px] text-secondary leading-[1.7]">
              Completed runs reveal durable trends instead of treating one
              non-deterministic answer as the truth.
            </p>
            <ol
              ref={stepsRef}
              data-cascade-in={stepsInView}
              className="mt-9 border-border border-t"
            >
              {[
                [
                  '01',
                  'Define',
                  'Build a prompt set around the questions buyers use to discover and compare products.',
                ],
                [
                  '02',
                  'Monitor',
                  'Run every prompt across the AI surfaces that matter to your market.',
                ],
                [
                  '03',
                  'Understand',
                  'Compare every signal while keeping the raw answer behind it.',
                ],
              ].map(([num, title, body], i) => (
                <li
                  key={num}
                  className="landing-cascade-item grid grid-cols-[34px_1fr] gap-3 border-border border-b py-5"
                  style={stagger(i)}
                >
                  <span className="pt-1 font-mono text-[10px] text-accent">
                    {num}
                  </span>
                  <div>
                    <strong className="font-normal text-[17px] text-primary">
                      {title}
                    </strong>
                    <p className="mt-2 text-[14px] text-secondary leading-[1.65]">
                      {body}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </LandingInset>
      </LandingContainer>
    </section>
  );
};
