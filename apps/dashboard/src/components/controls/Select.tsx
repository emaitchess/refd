import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { useOnKeyPress } from '@/lib/keyboard';
import { cn } from '@/lib/utils';

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
}) => {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(0, options.indexOf(value)),
  );
  const listboxId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const openMenu = () => {
    setActiveIndex(Math.max(0, options.indexOf(value)));
    setOpen(true);
  };
  const closeMenu = () => setOpen(false);
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
      {open ? (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-40 cursor-default"
            onClick={closeMenu}
          />
          <div
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel}
            className={cn(
              'absolute left-0 z-50 flex max-h-56 w-full flex-col overflow-y-auto border border-border-strong bg-bg-elevated shadow-lg',
              openUp ? 'bottom-full mb-1' : 'top-full mt-1',
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
      ) : null}
    </div>
  );
};
