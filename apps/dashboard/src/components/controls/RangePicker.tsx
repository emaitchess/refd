import { useSearchParams } from 'react-router';
import { Select } from '@/components/controls/Select';
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
  onChange: (r: RangeValue) => void;
}) => (
  <div className="flex items-center gap-1">
    {RANGES.map((r) => (
      <button
        key={r}
        type="button"
        aria-pressed={value === r}
        onClick={() => onChange(r)}
        className={cn(
          'rounded px-2 py-1 font-mono text-[11px] transition-colors',
          value === r
            ? 'bg-foreground text-background'
            : 'text-muted hover:text-foreground',
        )}
      >
        {r}
      </button>
    ))}
  </div>
);

export const COHORTS = ['branded', 'competitor', 'discovery'] as const;
export type CohortValue = (typeof COHORTS)[number] | 'all';

export const COHORT_LABEL: Record<(typeof COHORTS)[number], string> = {
  branded: 'Brand-named',
  competitor: 'Competitor-named',
  discovery: 'Names neither',
};

export const ALL_COHORTS = 'all';

// The `?kind=` query param, validated against COHORTS, defaulting to blended.
// Written with the functional setter so it composes with `?range=` instead of
// replacing it.
export const useCohort = (): [CohortValue, (c: CohortValue) => void] => {
  const [params, setParams] = useSearchParams();
  const raw = params.get('kind');
  const cohort = (COHORTS as readonly string[]).includes(raw ?? '')
    ? (raw as CohortValue)
    : ALL_COHORTS;
  return [
    cohort,
    (c) =>
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        if (c === ALL_COHORTS) {
          next.delete('kind');
        } else {
          next.set('kind', c);
        }
        return next;
      }),
  ];
};

export const CohortPicker = ({
  value,
  onChange,
}: {
  value: CohortValue;
  onChange: (c: CohortValue) => void;
}) => (
  <Select
    value={value}
    options={[ALL_COHORTS, ...COHORTS]}
    // Select is string-typed; the option list is the closed set, so a value
    // outside it cannot be produced by this control.
    onChange={(next) => onChange(next as CohortValue)}
    ariaLabel="Filter metrics by prompt cohort"
    size="sm"
    className="sm:w-48"
    renderOption={(option) =>
      option === ALL_COHORTS
        ? 'All prompts (blended)'
        : COHORT_LABEL[option as (typeof COHORTS)[number]]
    }
  />
);
