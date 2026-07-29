import { useSearchParams } from 'react-router';
import { cn } from '@/lib/utils';

export const RANGES = ['1d', '3d', '7d', '30d', '90d', 'all'] as const;
export type RangeValue = (typeof RANGES)[number];

// The `?range=` query param, validated against RANGES, defaulting to 30d.
export const useRange = (): [RangeValue, (r: RangeValue) => void] => {
  const [params, setParams] = useSearchParams();
  const raw = params.get('range');
  const range = (RANGES as readonly string[]).includes(raw ?? '')
    ? (raw as RangeValue)
    : '30d';
  return [range, (r) => setParams({ range: r })];
};

export const RangePicker = ({
  value,
  onChange,
}: {
  value: RangeValue;
  onChange: (range: RangeValue) => void;
}) => (
  <div className="inline-flex h-8 items-center gap-0.5 bg-accent-soft p-0.5">
    {RANGES.map((range) => (
      <button
        key={range}
        type="button"
        onClick={() => onChange(range)}
        className={cn(
          'h-7 cursor-pointer border border-transparent px-2.5 font-mono text-[11px] uppercase tracking-[0.04em] transition-colors duration-150 ease-house',
          range === value
            ? 'border-border-strong bg-bg-elevated text-primary'
            : 'text-secondary hover:text-primary',
        )}
      >
        {range}
      </button>
    ))}
  </div>
);
