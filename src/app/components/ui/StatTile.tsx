import type { ReactNode } from 'react';
import { DitherIcon } from '@/components/dither/DitherIcon';
import type { MetricDefinition } from '@/lib/metric-copy';
import { cn } from '@/lib/utils';
import { Card } from './Card';
import { MetricInfo } from './MetricInfo';
import { SectionLabel } from './SectionLabel';

export const StatTile = ({
  label,
  info,
  value,
  delta,
  deltaGood,
  spark,
  handleProps,
  className,
}: {
  label: string;
  info?: MetricDefinition;
  value: string;
  delta?: string | null;
  deltaGood?: boolean;
  spark?: ReactNode;
  handleProps?: Record<string, unknown>;
  className?: string;
}) => (
  <Card className={cn('group/tile flex h-full flex-col gap-2', className)}>
    <div className="flex items-start justify-between gap-2">
      <div className="flex items-center gap-1">
        <SectionLabel>{label}</SectionLabel>
        {info ? <MetricInfo label={label.toLowerCase()} metric={info} /> : null}
      </div>
      {handleProps ? (
        <button
          type="button"
          aria-label="Drag to reorder"
          className="-mt-1.5 -mr-2 shrink-0 cursor-grab touch-none px-1.5 py-1 text-muted opacity-0 transition-[opacity,color] duration-150 hover:text-primary focus-visible:opacity-100 active:cursor-grabbing group-hover/tile:opacity-100"
          {...handleProps}
        >
          <DitherIcon name="grip" size={12} />
        </button>
      ) : null}
    </div>
    <div className="flex items-end justify-between gap-2">
      <div className="font-mono text-[28px] text-primary leading-none">
        {value}
      </div>
      {delta ? (
        <div
          className={cn(
            'font-mono text-[13px]',
            deltaGood ? 'text-success' : 'text-error',
          )}
        >
          {delta}
        </div>
      ) : null}
    </div>
    {spark}
  </Card>
);
