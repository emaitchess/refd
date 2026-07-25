import type { DitherColor } from '@/components/dither-kit/palette';

// Fixed categorical order, brand first — chosen by brute-forcing dither-kit's
// named seeds through the palette validator (worst adjacent CVD ΔE 80.8; light
// + dark surfaces pass). Never cycle: entities beyond the six fold into grey.
export const SERIES_ORDER: DitherColor[] = [
  'green',
  'purple',
  'red',
  'blue',
  'orange',
  'pink',
];

export const seriesColor = (index: number): DitherColor =>
  SERIES_ORDER[index] ?? 'grey';

// Swatch hexes for DOM chips (the canvas paints from its own seeds).
export const SERIES_HEX: Record<DitherColor, string> = {
  green: '#28d26e',
  purple: '#966eff',
  red: '#f04646',
  blue: '#358ff3',
  orange: '#ff9632',
  pink: '#f05abe',
  grey: '#5c5c64',
};
