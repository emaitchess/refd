import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useDialogFocus } from '@/hooks/useDialogFocus';
import { useOnKeyPress } from '@/lib/keyboard';
import { cn } from '@/lib/utils';

const EXIT_MS = 200; // keep in sync with pane-slide-out in global.css
let pageScrollLocks = 0;
let restorePageScroll: (() => void) | null = null;

// Reference counting prevents a nested pane from restoring page scroll while
// the pane beneath it is still open, regardless of effect cleanup order.
const lockPageScroll = () => {
  if (pageScrollLocks === 0) {
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    restorePageScroll = () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }
  pageScrollLocks += 1;
  return () => {
    pageScrollLocks = Math.max(0, pageScrollLocks - 1);
    if (pageScrollLocks === 0) {
      restorePageScroll?.();
      restorePageScroll = null;
    }
  };
};

// Shared right-side overlay: scrim, sliding panel, titled header with a keycap
// close, and a scrollable body. `escapeEnabled` lets a pane suppress its own
// Escape handler while a nested pane is open; `overlay` renders after the panel
// (e.g. a nested pane) inside the same fixed root.
export const SidePane = ({
  label,
  title,
  onClose,
  onCloseStart,
  escapeEnabled = true,
  nested = false,
  blurred,
  overlay,
  children,
}: {
  label: React.ReactNode;
  title: React.ReactNode;
  onClose: () => void;
  onCloseStart?: () => void;
  escapeEnabled?: boolean;
  nested?: boolean;
  blurred?: boolean;
  overlay?: React.ReactNode;
  children: React.ReactNode;
}) => {
  // Closing plays the exit animation first, then unmounts. Reduced motion skips
  // straight to the unmount: with no animation running, waiting would read as lag.
  const [closing, setClosing] = useState(false);
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const requestClose = useCallback(() => {
    if (closing) {
      return;
    }
    onCloseStart?.();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onClose();
      return;
    }
    setClosing(true);
  }, [closing, onClose, onCloseStart]);
  const shouldBlur = blurred ?? Boolean(overlay);
  useDialogFocus(panelRef, closeRef, {
    active: !overlay,
    lockScroll: false,
  });

  useEffect(() => {
    const unlockPageScroll = lockPageScroll();
    return unlockPageScroll;
  }, []);

  useEffect(() => {
    if (!closing) {
      return;
    }
    // A timer, not onAnimationEnd: the unmount must happen even if the animation
    // never fires (interrupted, or the element is off-screen).
    const timer = setTimeout(onClose, EXIT_MS);
    return () => clearTimeout(timer);
  }, [closing, onClose]);

  useOnKeyPress('Escape', requestClose, {
    enabled: escapeEnabled && !closing,
    ignoreWhenTyping: false,
  });

  return (
    <div
      className={cn(nested ? 'absolute inset-0 z-10' : 'fixed inset-0 z-50')}
    >
      <button
        type="button"
        aria-label="Close"
        aria-hidden={overlay ? true : undefined}
        disabled={Boolean(overlay)}
        className={cn(
          'absolute inset-0 cursor-default',
          nested ? 'bg-transparent' : 'pane-scrim',
          closing && !nested && 'pane-scrim-out',
        )}
        onClick={requestClose}
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal={overlay ? undefined : true}
        aria-labelledby={titleId}
        tabIndex={-1}
        inert={overlay ? true : undefined}
        aria-hidden={overlay ? true : undefined}
        className={cn(
          'pane-panel absolute inset-y-0 right-0 flex flex-col overflow-hidden border-border-strong border-l bg-bg-elevated transition-[filter] duration-200 ease-house',
          nested
            ? 'w-[calc(100%_-_1.5rem)] shadow-[-18px_0_45px_var(--color-shadow)] sm:w-[calc(50%_-_2rem)]'
            : 'w-full shadow-lg sm:w-1/2',
          shouldBlur && 'blur-[1.5px]',
          closing && 'pane-panel-out',
        )}
      >
        <header className="flex items-start justify-between gap-3 border-border border-b px-5 py-4">
          {/* min-w-0 lets a long title wrap instead of pushing the close button
              out of the row. */}
          <div className="min-w-0 flex-1">
            <div className="section-label mb-1">{label}</div>
            <div id={titleId}>{title}</div>
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close"
            className="btn-ghost h-7 shrink-0 gap-1.5 whitespace-nowrap px-2"
            onClick={requestClose}
          >
            <kbd className="kbd px-1.5">esc</kbd>
            <span className="font-mono text-[12px] leading-none">✕</span>
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </aside>
      {overlay}
    </div>
  );
};
