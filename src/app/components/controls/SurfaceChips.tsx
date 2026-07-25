import { SurfaceLogo } from '@/components/svgs/SurfaceLogo';
import { surfaceLabel } from '@/lib/format';
import { ALL_SURFACES } from '@/lib/onboarding';
import { cn } from '@/lib/utils';

// Toggleable AI-surface selector. At least one surface always stays enabled.
// Monochrome chips (selected = accent-soft fill + primary text); provider logos
// are currentColor so they follow the chip's ink.
export const SurfaceChips = ({
  selected,
  onChange,
  disabled = false,
}: {
  selected: string[];
  onChange: (surfaces: string[]) => void;
  disabled?: boolean;
}) => {
  const set = new Set(selected);
  const toggle = (s: string) => {
    const next = set.has(s)
      ? selected.filter((x) => x !== s)
      : [...selected, s];
    if (next.length === 0) {
      return;
    }
    onChange(next);
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {ALL_SURFACES.map((s) => {
        const on = set.has(s);
        return (
          <button
            key={s}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            onClick={() => toggle(s)}
            className={cn(
              'flex cursor-pointer items-center gap-1.5 border px-2.5 py-1 font-mono text-[11px] transition-colors',
              on
                ? 'border-border-strong bg-accent-soft text-primary'
                : 'border-border text-muted hover:text-secondary',
              disabled && 'opacity-50',
            )}
          >
            <SurfaceLogo surface={s} className="h-3.5 w-3.5" />
            {surfaceLabel(s)}
          </button>
        );
      })}
    </div>
  );
};
