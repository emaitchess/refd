import { DitherGradient } from '@/components/dither-kit/gradient';
import { useTheme } from '@/lib/theme';
import { GITHUB_URL, LandingContainer, LandingInset } from './chrome';

export const OpenSourceSection = () => {
  const [theme] = useTheme();

  return (
    <section
      id="open-source"
      className="relative overflow-hidden border-border border-b text-primary"
      style={{ scrollMarginTop: 'var(--public-header-height, 56px)' }}
    >
      <LandingContainer className="overflow-hidden">
        <DitherGradient
          from="red"
          to="transparent"
          direction="up"
          cell={3}
          opacity={theme === 'dark' ? 0.21 : 0.12}
          bloom="off"
        />
        <LandingInset className="relative z-1 grid gap-10 py-16 sm:py-20 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="font-mono text-[10px] text-accent uppercase tracking-[0.16em]">
              open source by default
            </p>
            <h2 className="mt-5 max-w-[760px] text-[38px] leading-[1.05] tracking-[-0.04em] sm:text-[58px]">
              Run it with us. Or run the whole stack yourself.
            </h2>
            <p className="mt-6 max-w-[620px] text-[14px] text-secondary leading-[1.75]">
              refd is an MIT-licensed stack of three Cloudflare Workers with a
              React dashboard, Astro site, D1, R2, Queues, and Bright Data. Read
              the measurement code, fork the project, or use the managed
              service.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <a href="/open-source" className="btn-secondary h-11 px-5">
              how it is built
            </a>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="group btn-primary h-11 px-5"
            >
              view the source{' '}
              <span
                aria-hidden
                className="transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transition-none"
              >
                ↗
              </span>
            </a>
          </div>
        </LandingInset>
      </LandingContainer>
    </section>
  );
};
