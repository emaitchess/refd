import { type ReactNode, useEffect, useRef, useState } from 'react';

// One-shot viewport trigger for scroll-entrance animations; disconnects after
// the first hit so re-scrolling never replays them.
export const useInViewOnce = <T extends HTMLElement>(threshold = 0.3) => {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);

  return [ref, inView] as const;
};

// Counts 0 → target once active; reduced motion snaps straight to the target.
export const useCountUp = (target: number, active: boolean, duration = 700) => {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!active) {
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setValue(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      setValue(target * (1 - (1 - t) ** 3));
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, target, duration]);

  return value;
};

// Entrance for the demo charts: sweep (areas, left to right), rise (bars,
// bottom up), zoom (radar). Reduced motion renders them already drawn.
// The observed div must stay unclipped: Chrome intersects the *clipped*
// rect, so a fully self-clipped element never reports as intersecting and
// would never reveal. The clip therefore lives on an inner div.
export const ChartReveal = ({
  variant,
  children,
}: {
  variant: 'sweep' | 'rise' | 'zoom';
  children: ReactNode;
}) => {
  const [ref, inView] = useInViewOnce<HTMLDivElement>(0.35);
  return (
    <div ref={ref} className="h-full w-full">
      <div
        className={`landing-chart-reveal landing-chart-${variant} h-full w-full ${
          inView ? 'landing-chart-in' : ''
        }`}
      >
        {children}
      </div>
    </div>
  );
};
