import { DitherGradient } from '@/components/dither-kit/gradient';
import type { PixelColor } from '@/components/dither-kit/pixel';
import { Tooltip } from '@/components/dither-kit/tooltip';
import type { SentimentDist } from '@/lib/types';
import { cn } from '@/lib/utils';

export type SentimentValue = 'positive' | 'neutral' | 'negative';

// Shared aggregate helpers so every sentiment column ranks, leads, and
// labels distributions the same way.

// Sort key: positive share of classified mentions; null sorts last like
// every other null metric.
export const positiveShare = (dist: SentimentDist): number | null => {
  if (!dist) {
    return null;
  }
  const total = dist.positive + dist.neutral + dist.negative;
  return total === 0 ? null : dist.positive / total;
};

// The stance to lead with: the most frequent one, negative first on ties (a
// tie involving negativity is the thing worth noticing).
export const dominantStance = (dist: SentimentDist): SentimentValue | null => {
  if (!dist) {
    return null;
  }
  const ranked: [SentimentValue, number][] = [
    ['negative', dist.negative],
    ['positive', dist.positive],
    ['neutral', dist.neutral],
  ];
  const top = ranked.reduce((a, b) => (b[1] > a[1] ? b : a));
  return top[1] > 0 ? top[0] : null;
};

// Compact "pos/neu/neg" percentage split, e.g. "67/22/11". Neutral takes the
// rounding remainder so the three always sum to 100.
export const sentimentSplit = (dist: SentimentDist): string => {
  if (!dist) {
    return '—';
  }
  const total = dist.positive + dist.neutral + dist.negative;
  if (total === 0) {
    return '—';
  }
  const pos = Math.round((dist.positive / total) * 100);
  const neg = Math.round((dist.negative / total) * 100);
  return `${pos}/${Math.max(0, 100 - pos - neg)}/${neg}`;
};

// Sentiment tag in the PromptCategoryTag visual language: bordered mono chip
// with a dithered wash. Glyph + word together — the word makes the tag
// self-describing, the glyph and hue keep a column of them scannable, and the
// text stays on a text token so color is never the only identifier
// (DESIGN.md). Grey is the wash's only achromatic option, which suits
// neutral exactly.
const STANCES: Record<SentimentValue, { glyph: string; wash: PixelColor }> = {
  positive: { glyph: '+', wash: 'green' },
  neutral: { glyph: '·', wash: 'grey' },
  negative: { glyph: '−', wash: 'red' },
};

export const SentimentTag = ({
  sentiment,
  className,
}: {
  sentiment: SentimentValue;
  className?: string;
}) => (
  <span
    className={cn(
      'relative isolate inline-flex h-5 items-center gap-1 overflow-hidden border border-border bg-bg-elevated px-1.5 font-mono text-[10px] text-primary tracking-[0.04em]',
      className,
    )}
  >
    <DitherGradient
      from={STANCES[sentiment].wash}
      direction="right"
      cell={2}
      opacity={0.34}
    />
    <span className="relative z-10">{STANCES[sentiment].glyph}</span>
    <span className="relative z-10">{sentiment}</span>
  </span>
);

// Distribution as a table cell: the dominant stance's tag with the full
// count split in the tooltip; "—" when nothing is classified.
export const SentimentDistTag = ({ dist }: { dist: SentimentDist }) => {
  const stance = dominantStance(dist);
  if (!dist || !stance) {
    return <span className="font-mono text-[11px] text-muted">—</span>;
  }
  return (
    <Tooltip
      content={`${dist.positive} positive · ${dist.neutral} neutral · ${dist.negative} negative`}
      className="border-border-strong bg-bg-elevated text-primary shadow-lg"
    >
      <SentimentTag sentiment={stance} />
    </Tooltip>
  );
};
