import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useOnKeyPress } from '@/lib/keyboard';
import { cn } from '@/lib/utils';

// Matches the listbox's max-h-56; the fixed-position mode clamps the menu to
// the viewport space it actually has.
const LIST_MAX_PX = 224;
const LIST_GAP_PX = 4;

interface FixedAnchor {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  up: boolean;
}

// Custom single-select styled to match the app (square, monochrome) in place of a
// native <select>. Closes on outside click or Escape.
export const Select = ({
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel,
  openUp = false,
  size = 'md',
  renderOption,
  className,
  position = 'absolute',
}: {
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
  // Open above the trigger — for selects near the bottom of a scroll container.
  openUp?: boolean;
  size?: 'sm' | 'md';
  renderOption?: (option: string) => ReactNode;
  className?: string;
  // 'fixed' renders the listbox in a portal anchored to the trigger's viewport
  // rect: inside modals and other scroll containers an absolutely positioned
  // menu becomes scroll overflow and gets clipped, a fixed one overlays.
  position?: 'absolute' | 'fixed';
}) => {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<FixedAnchor | null>(null);
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(0, options.indexOf(value)),
  );
  const listboxId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const openMenu = () => {
    setActiveIndex(Math.max(0, options.indexOf(value)));
    if (position === 'fixed') {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) {
        const spaceBelow = window.innerHeight - rect.bottom;
        const spaceAbove = rect.top;
        const up =
          !openUp &&
          spaceBelow < LIST_MAX_PX + LIST_GAP_PX &&
          spaceAbove > spaceBelow;
        const maxHeight = Math.max(
          120,
          Math.min(
            LIST_MAX_PX,
            (up ? spaceAbove : spaceBelow) - LIST_GAP_PX - 8,
          ),
        );
        setAnchor({
          left: rect.left,
          top: up ? rect.top - LIST_GAP_PX : rect.bottom + LIST_GAP_PX,
          width: rect.width,
          maxHeight,
          up,
        });
      }
    }
    setOpen(true);
  };
  const closeMenu = () => {
    setOpen(false);
    setAnchor(null);
  };
  const selectOption = (option: string) => {
    onChange(option);
    closeMenu();
    triggerRef.current?.focus();
  };
  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((current) =>
        options.length === 0
          ? 0
          : (current + direction + options.length) % options.length,
      );
      return;
    }
    if (!open) {
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setActiveIndex(
        event.key === 'Home' ? 0 : Math.max(0, options.length - 1),
      );
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const option = options[activeIndex];
      if (option !== undefined) {
        selectOption(option);
      }
    }
  };

  useOnKeyPress(
    'Escape',
    () => {
      closeMenu();
      triggerRef.current?.focus();
    },
    { enabled: open },
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    optionRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  const menu = (fixed: boolean) => (
    <>
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        className={cn(
          'fixed inset-0 cursor-default',
          fixed ? 'z-[55]' : 'z-40',
        )}
        onClick={closeMenu}
      />
      <div
        id={listboxId}
        role="listbox"
        aria-label={ariaLabel}
        style={
          fixed && anchor
            ? {
                position: 'fixed',
                left: anchor.left,
                width: anchor.width,
                maxHeight: anchor.maxHeight,
                ...(anchor.up
                  ? { bottom: window.innerHeight - anchor.top }
                  : { top: anchor.top }),
              }
            : undefined
        }
        className={cn(
          'flex max-h-56 w-full flex-col overflow-y-auto border border-border-strong bg-bg-elevated shadow-lg',
          fixed ? 'z-[60]' : 'absolute z-50',
          !fixed && (openUp ? 'bottom-full mb-1' : 'top-full mt-1'),
        )}
      >
        {options.map((opt, index) => (
          <button
            key={opt}
            ref={(node) => {
              optionRefs.current[index] = node;
            }}
            id={`${listboxId}-option-${index}`}
            type="button"
            role="option"
            aria-selected={opt === value}
            tabIndex={-1}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => selectOption(opt)}
            className={cn(
              'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[13px] transition-colors hover:bg-bg-card-hover',
              size === 'sm' && 'px-2.5 py-1 font-mono text-[11px]',
              opt === value ? 'text-primary' : 'text-secondary',
              index === activeIndex && 'bg-bg-card-hover text-primary',
            )}
          >
            <span className="min-w-0 flex-1">
              {renderOption ? renderOption(opt) : opt}
            </span>
            {opt === value ? (
              <span className="font-mono text-[11px] text-muted">✓</span>
            ) : null}
          </button>
        ))}
      </div>
    </>
  );

  return (
    <div className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={
          open ? `${listboxId}-option-${activeIndex}` : undefined
        }
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={onTriggerKeyDown}
        className={cn(
          'input flex w-full items-center justify-between gap-2 text-left',
          size === 'sm' && 'h-8 px-2.5 font-mono text-[11px]',
        )}
      >
        <span className="min-w-0 flex-1 truncate">
          {renderOption ? renderOption(value) : value}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-muted">▾</span>
      </button>
      {open
        ? position === 'fixed'
          ? createPortal(menu(true), document.body)
          : menu(false)
        : null}
    </div>
  );
};
