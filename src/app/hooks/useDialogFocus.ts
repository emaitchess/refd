import { type RefObject, useEffect } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export const useDialogFocus = (
  panelRef: RefObject<HTMLElement | null>,
  initialFocusRef?: RefObject<HTMLElement | null>,
  {
    active = true,
    lockScroll = true,
  }: {
    active?: boolean;
    lockScroll?: boolean;
  } = {},
) => {
  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    if (lockScroll) {
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
    }

    return () => {
      if (lockScroll) {
        document.body.style.overflow = previousBodyOverflow;
        document.documentElement.style.overflow = previousHtmlOverflow;
      }
      if (previousFocus?.isConnected) {
        previousFocus.focus();
      }
    };
  }, [lockScroll]);

  useEffect(() => {
    if (!active) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel || panel.contains(document.activeElement)) {
        return;
      }
      initialFocusRef?.current?.focus();
      if (document.activeElement === initialFocusRef?.current) {
        return;
      }
      panel.querySelector<HTMLElement>(FOCUSABLE)?.focus();
      if (!panel.contains(document.activeElement)) {
        panel.focus();
      }
    });
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') {
        return;
      }
      const focusable = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
      );
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!panelRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', trapFocus);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', trapFocus);
    };
  }, [active, initialFocusRef, panelRef]);
};
