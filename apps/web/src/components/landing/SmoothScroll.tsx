import 'lenis/dist/lenis.css';
import { ReactLenis, useLenis } from 'lenis/react';
import { type ReactNode, useEffect } from 'react';

const currentHashTarget = () => {
  const id = window.location.hash.slice(1);
  if (!id) {
    return null;
  }
  try {
    return document.getElementById(decodeURIComponent(id));
  } catch {
    return null;
  }
};

const NativeHashScroll = () => {
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      currentHashTarget()?.scrollIntoView();
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  return null;
};

const SmoothAnchors = () => {
  const lenis = useLenis();

  useEffect(() => {
    if (!lenis) {
      return;
    }
    const initialTarget = currentHashTarget();
    const frame = initialTarget
      ? requestAnimationFrame(() => {
          lenis.scrollTo(initialTarget, { force: true, immediate: true });
        })
      : null;
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
    const onPublicMenu = (event: Event) => {
      if (
        event instanceof CustomEvent &&
        typeof event.detail === 'object' &&
        event.detail !== null &&
        'open' in event.detail
      ) {
        event.detail.open === true ? lenis.stop() : lenis.start();
      }
    };
    window.addEventListener('refd:public-menu', onPublicMenu);
    return () => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      document.removeEventListener('click', onClick);
      window.removeEventListener('refd:public-menu', onPublicMenu);
    };
  }, [lenis]);

  return null;
};

// Landing-only smooth scrolling: mounts with the page, destroyed on route
// change, so the dashboard keeps native scrolling. Reduced motion opts out
// entirely and anchors fall back to the browser's instant jump.
export const SmoothScroll = ({ children }: { children: ReactNode }) => {
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (still) {
    return (
      <>
        <NativeHashScroll />
        {children}
      </>
    );
  }
  return (
    <ReactLenis root>
      <SmoothAnchors />
      {children}
    </ReactLenis>
  );
};
