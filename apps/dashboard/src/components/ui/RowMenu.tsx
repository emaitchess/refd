import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useOnKeyPress } from '@/lib/keyboard';
import { cn } from '@/lib/utils';

// Ellipsis row menu. Positioned from the trigger's viewport rect and portaled
// to document.body: `.card` sets backdrop-blur, which makes the card the
// containing block for fixed descendants, so an in-place menu would be offset
// against the card and clipped by its overflow-x-auto. Closes on outside press,
// Esc, scroll, or selection.
export const RowMenu = ({
  items,
  label = 'Row actions',
}: {
  items: { label: string; onSelect: () => void; tone?: 'default' | 'danger' }[];
  label?: string;
}) => {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useOnKeyPress('Escape', () => setPos(null), {
    enabled: pos !== null,
    ignoreWhenTyping: false,
  });
  useEffect(() => {
    if (!pos) {
      return;
    }
    const close = () => setPos(null);
    // The menu is portaled, so it is outside rootRef in the DOM: test both, or
    // pointerdown unmounts it before a menuitem's click can land.
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        close();
      }
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', close, true);
    };
  }, [pos]);

  return (
    <div
      ref={rootRef}
      className="inline-block"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={pos !== null}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setPos(pos ? null : { top: rect.bottom + 4, left: rect.right });
        }}
        className="btn-ghost h-6 px-1.5 font-mono text-[14px] leading-none"
      >
        ⋮
      </button>
      {pos
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              style={{ top: pos.top, left: pos.left }}
              className="fixed z-40 min-w-28 -translate-x-full border border-border-strong bg-bg-elevated py-1 shadow-lg"
            >
              {items.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setPos(null);
                    item.onSelect();
                  }}
                  className={cn(
                    'block w-full cursor-pointer px-3 py-1.5 text-left font-mono text-[11px] transition-colors hover:bg-bg-card-hover',
                    item.tone === 'danger'
                      ? 'text-error'
                      : 'text-secondary hover:text-primary',
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
};
