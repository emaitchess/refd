import { SERIES_HEX, seriesColor } from '@/lib/chart-colors';

export const EntityChip = ({
  name,
  sortIndex,
}: {
  name: string;
  sortIndex: number;
}) => (
  <span className="inline-flex items-center gap-2 text-[13px] text-primary">
    <span
      aria-hidden
      className="inline-block size-2"
      style={{ background: SERIES_HEX[seriesColor(sortIndex)] }}
    />
    {name}
  </span>
);
