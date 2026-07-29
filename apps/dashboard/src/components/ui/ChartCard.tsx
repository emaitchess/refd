import type { ReactNode } from 'react';
import { DitherIcon } from '@/components/dither/DitherIcon';
import { cn } from '@/lib/utils';
import { Card } from './Card';

// Chart panel with a segregated header strip: elevated bg + hairline bottom
// border, mono title; body carries the plot.
export const ChartCard = ({
  title,
  className,
  handleProps,
  children,
}: {
  title: ReactNode;
  className?: string;
  handleProps?: Record<string, unknown>;
  children: ReactNode;
}) => (
  <Card className={cn('group/chart overflow-hidden p-0', className)}>
    <div className="flex items-center justify-between gap-2 border-border border-b bg-bg-elevated px-5 py-3">
      <h2 className="font-mono text-[11px] text-primary uppercase tracking-[0.1em]">
        {title}
      </h2>
      {handleProps ? (
        <button
          type="button"
          aria-label="Drag to reorder"
          className="-mr-1.5 shrink-0 cursor-grab touch-none px-1.5 py-0.5 text-muted opacity-0 transition-[opacity,color] duration-150 hover:text-primary focus-visible:opacity-100 active:cursor-grabbing group-hover/chart:opacity-100"
          {...handleProps}
        >
          <DitherIcon name="grip" size={12} />
        </button>
      ) : null}
    </div>
    <div className="p-5">{children}</div>
  </Card>
);
