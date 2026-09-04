// Ordered-dither loading glyph: a 4x4 block whose cells flip in Bayer order,
// so the wave is driven by the same matrix that fills the charts rather than
// by a lookalike sequence. Cells modulate opacity in one currentColor, per
// the kit's colour-vs-opacity rule, so it reads on both themes wherever the
// surrounding text sits.
//
// The inline opacity is the reduced-motion still frame: a real half-density
// dither pattern rather than a frozen blank. A running animation outranks an
// inline style, so it only shows when motion is allowed.
import { BAYER } from '@/components/dither-kit/dither-paint';
import { cn } from '@/lib/utils';

const CYCLE_MS = 1200;
// Matches the kit's OFF_TIER: an unlit cell is a faint tint of the same
// colour, never a hole.
const OFF = 0.4;

export const DitherLoader = ({
  size = 14,
  className,
}: {
  size?: number;
  className?: string;
}) => (
  // biome-ignore lint/a11y/noSvgWithoutTitle: decorative, rendered aria-hidden
  <svg
    viewBox="0 0 4 4"
    width={size}
    height={size}
    shapeRendering="crispEdges"
    fill="currentColor"
    aria-hidden
    className={cn('dither-loader shrink-0', className)}
  >
    {BAYER.flatMap((row: number[], y: number) =>
      row.map((threshold: number, x: number) => (
        <rect
          key={`${x}-${y}`}
          x={x}
          y={y}
          width={1}
          height={1}
          style={{
            opacity: threshold < 0.5 ? 1 : OFF,
            animationDelay: `${Math.round(threshold * CYCLE_MS)}ms`,
          }}
        />
      )),
    )}
  </svg>
);
