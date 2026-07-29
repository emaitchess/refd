import { Dithering } from '@paper-design/shaders-react';
import { useEffect, useRef, useState } from 'react';
import { useTheme } from '@/lib/theme';

export const HeroDither = () => {
  const ref = useRef<HTMLDivElement>(null);
  const [theme] = useTheme();
  const [offscreen, setOffscreen] = useState(false);
  const still =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Speed 0 cancels the shader's animation loop instead of rendering unseen frames.
  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      setOffscreen(!(entry?.isIntersecting ?? true));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 0,
        pointerEvents: 'none',
        opacity: theme === 'dark' ? 0.75 : 0.65,
      }}
    >
      <Dithering
        width="100%"
        height="100%"
        colorBack={theme === 'dark' ? '#080809' : '#f7f4f0'}
        colorFront={theme === 'dark' ? '#3a1118' : '#e2b6bd'}
        scale={1}
        shape="warp"
        size={2}
        speed={still || offscreen ? 0 : 0.25}
        type="2x2"
      />
    </div>
  );
};
