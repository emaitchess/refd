import { DitherButton } from '@/components/dither-kit/button';
import { SurfaceLogo } from '@/components/svgs/SurfaceLogo';
import { SURFACE_ORDER, surfaceLabel } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { LandingContainer, LandingInset, useAccountCta } from './chrome';
import { HeroDither } from './HeroDither';

export const Hero = () => {
  const { to } = useAccountCta();
  const [theme] = useTheme();

  return (
    <section
      id="top"
      className="relative flex min-h-svh flex-col overflow-hidden border-border border-b"
      style={{
        minHeight: 'calc(100svh - var(--public-header-height, 72px))',
      }}
    >
      <HeroDither />
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-0 ${
          theme === 'dark'
            ? 'bg-[radial-gradient(ellipse_at_50%_46%,rgba(8,8,9,0.18)_0%,rgba(8,8,9,0.5)_58%,rgba(8,8,9,0.9)_100%)]'
            : 'bg-[radial-gradient(ellipse_at_50%_46%,rgba(247,244,240,0.3)_0%,rgba(247,244,240,0.62)_58%,rgba(247,244,240,0.95)_100%)]'
        }`}
      />

      <LandingContainer className="relative z-1 flex flex-1">
        <LandingInset className="flex flex-1 flex-col items-center justify-center py-20 text-center sm:py-24">
          <div className="landing-hero-reveal landing-hero-reveal-1 relative border border-border-strong bg-bg/45 px-3 py-1.5 backdrop-blur-md">
            <p className="font-mono text-[10px] text-secondary uppercase tracking-[0.16em]">
              open-source ai search monitoring
            </p>
          </div>
          <h1 className="landing-hero-reveal landing-hero-reveal-2 mt-8 max-w-[980px] tracking-[-0.045em]">
            <span className="block text-balance font-[520] text-[42px] leading-[0.98] sm:text-[64px] lg:text-[78px]">
              See how your brand performs
            </span>
            <span className="mt-2 block font-normal font-sans text-[34px] text-primary leading-[1.05] tracking-[-0.04em] sm:text-[50px] lg:text-[64px]">
              in AI search.
            </span>
          </h1>
          <p className="landing-hero-reveal landing-hero-reveal-3 mt-7 max-w-[670px] text-[14px] text-secondary leading-[1.7] sm:text-[16px]">
            Monitor the questions that drive discovery across five leading AI
            platforms. Benchmark competitors, trace citations, and verify every
            metric against the raw answer.
          </p>
          <div className="landing-hero-reveal landing-hero-reveal-4 mt-9 flex flex-wrap items-center justify-center gap-3">
            <DitherButton
              color="red"
              variant="gradient"
              bloom="off"
              className="h-10 rounded-none px-5 font-medium font-sans text-(--color-dither-button-text) text-[13px] transition-transform duration-150 active:scale-98"
              onClick={() => {
                window.location.href = to;
              }}
            >
              start monitoring
            </DitherButton>
            <a href="/demo" className="btn-secondary h-10 px-5">
              explore the demo
            </a>
          </div>
        </LandingInset>
      </LandingContainer>

      <div className="landing-hero-reveal landing-hero-reveal-5 relative z-1 border-border border-t bg-bg/35 backdrop-blur-sm">
        <LandingContainer>
          <LandingInset className="flex flex-col items-center gap-4 py-5 text-primary lg:flex-row lg:justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em]">
              monitored surfaces
            </span>
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 lg:justify-end">
              {SURFACE_ORDER.map((surface) => (
                <span key={surface} className="flex items-center gap-2">
                  <SurfaceLogo surface={surface} className="h-3.5 w-3.5" />
                  <span className="font-mono text-[11px]">
                    {surfaceLabel(surface)}
                  </span>
                </span>
              ))}
            </div>
          </LandingInset>
        </LandingContainer>
      </div>
    </section>
  );
};
