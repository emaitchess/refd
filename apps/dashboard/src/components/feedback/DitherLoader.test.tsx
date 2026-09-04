import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { BAYER } from '@/components/dither-kit/dither-paint';
import { DitherLoader } from './DitherLoader';

const html = renderToStaticMarkup(<DitherLoader />);
const cells = [...html.matchAll(/<rect/g)];

test('renders one cell per Bayer threshold', () => {
  expect(cells).toHaveLength(16);
});

// The wave has to travel in ordered-dither order, not in DOM order, or it
// reads as a scanline sweeping the block rather than a dither scatter.
test('each cell is delayed by its own Bayer threshold', () => {
  const delays = [...html.matchAll(/animation-delay:\s*(\d+)ms/g)].map((m) =>
    Number(m[1]),
  );
  const expected = BAYER.flatMap((row: number[]) =>
    row.map((t: number) => Math.round(t * 1200)),
  );
  expect(delays).toEqual(expected);
  // DOM order is not delay order: neighbours must not fire together.
  expect(delays).not.toEqual([...delays].sort((a, b) => a - b));
});

// Reduced motion suppresses the animation, so the inline opacity is what a
// user actually sees. It must be a real half-density dither block.
test('the still frame is a half-density dither pattern', () => {
  const lit = [...html.matchAll(/opacity:\s*([\d.]+)/g)].filter(
    (m) => m[1] === '1',
  );
  expect(lit).toHaveLength(8);
});

test('the glyph is decorative', () => {
  expect(html).toContain('aria-hidden');
  expect(html).not.toContain('<title>');
});
