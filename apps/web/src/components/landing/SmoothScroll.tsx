import 'lenis/dist/lenis.css';
import { ReactLenis, useLenis } from 'lenis/react';
import { type ReactNode, useEffect } from 'react';

// Routes same-page anchor clicks through Lenis so they animate instead of
// jumping. Lenis reads the target's scroll-margin-top, so the fixed-header
// offset stays defined once, in the sections' scroll-mt classes. force lets
// a click inside the open mobile menu scroll even while the menu holds Lenis
// stopped; the menu's own close handler runs first (React delegates at #root,
// below this document listener).
const SmoothAnchors = () => {
  const lenis = useLenis();

  useEffect(() => {
    if (!lenis) {
      return;
    }
    const onClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const anchor = (
        event.target as Element | null
      )?.closest<HTMLAnchorElement>('a[href^="#"]');
      if (!anchor || anchor.hash.length < 2) {
        return;
      }
      const target = document.querySelector<HTMLElement>(anchor.hash);
      if (!target) {
        return;
      }
      event.preventDefault();
      history.pushState(null, '', anchor.hash);
      lenis.scrollTo(target, { force: true });
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [lenis]);

  return null;
};

// Landing-only smooth scrolling: mounts with the page, destroyed on route
// change, so the dashboard keeps native scrolling. Reduced motion opts out
// entirely and anchors fall back to the browser's instant jump.
export const SmoothScroll = ({ children }: { children: ReactNode }) => {
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (still) {
    return children;
  }
  return (
    <ReactLenis root>
      <SmoothAnchors />
      {children}
    </ReactLenis>
  );
};
