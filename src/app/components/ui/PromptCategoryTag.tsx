import { DitherGradient } from '@/components/dither-kit/gradient';
import {
  promptCategoryColor,
  UNCATEGORIZED_CATEGORY,
} from '@/lib/prompt-categories';
import { cn } from '@/lib/utils';

export const PromptCategoryTag = ({
  category,
  count,
  active = false,
  size = 'sm',
  className,
}: {
  category: string;
  count?: number;
  active?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}) => {
  const label = category.trim() || UNCATEGORIZED_CATEGORY;

  return (
    <span
      className={cn(
        'relative isolate inline-flex max-w-full items-center gap-1.5 overflow-hidden border bg-bg-elevated font-mono text-primary',
        active ? 'border-border-strong' : 'border-border',
        size === 'sm'
          ? 'h-5 px-1.5 text-[10px] tracking-[0.04em]'
          : 'h-7 px-2 text-[11px] tracking-[0.04em]',
        className,
      )}
    >
      <DitherGradient
        from={promptCategoryColor(label)}
        direction="right"
        cell={2}
        opacity={active ? 0.5 : 0.34}
      />
      <span className="relative z-10 truncate">{label}</span>
      {count === undefined ? null : (
        <span className="relative z-10 shrink-0 text-secondary tabular-nums">
          {count}
        </span>
      )}
    </span>
  );
};
