import { Area } from '@/components/dither-kit/area';
import { AreaChart } from '@/components/dither-kit/area-chart';
import { Dot } from '@/components/dither-kit/dot';
import { Grid } from '@/components/dither-kit/grid';

export type TrendPoint = { period: number; visibility: number };

export const SignalChart = ({ data }: { data: TrendPoint[] }) => (
  <AreaChart
    data={data}
    config={{ visibility: { label: 'your brand', color: 'red' } }}
    interactive={false}
    markerIndex={data.length - 1}
    bloom="low"
    margins={{ top: 8, right: 0, bottom: 0, left: 0 }}
    className="h-full w-full"
  >
    <Grid />
    <Area dataKey="visibility" variant="gradient">
      <Dot variant="colored-border" r={2} />
    </Area>
  </AreaChart>
);
