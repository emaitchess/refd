import { useState } from 'react';
import { cn } from '@/lib/utils';

// Higher-res favicon sources, best first: favicon.im returns the largest icon
// (often a 180px apple-touch-icon), google s2 at 128 is the reliable fallback.
// Downscaled via CSS to the display size, so it stays crisp on retina.
const sources = (domain: string): string[] => [
  `https://favicon.im/${domain}?larger=true`,
  `https://www.google.com/s2/favicons?domain=${domain}&sz=128`,
];

// Favicon for a domain (URL input, brand step marker, competitor rows). Square,
// theme-aware placeholder when every source fails — no rounded corners (DESIGN.md).
export const Favicon = ({
  domain,
  size = 16,
  className,
}: {
  domain: string;
  size?: number;
  className?: string;
}) => {
  const [stage, setStage] = useState(0);
  const box = { width: size, height: size };
  const src = domain ? sources(domain)[stage] : undefined;

  if (!src) {
    return (
      <span
        className={cn(
          'inline-block shrink-0 border border-border bg-bg-elevated',
          className,
        )}
        style={box}
        aria-hidden
      />
    );
  }
  return (
    <img
      src={src}
      alt=""
      className={cn('favicon-contrast shrink-0 object-contain', className)}
      style={box}
      onError={() => setStage((s) => s + 1)}
    />
  );
};
