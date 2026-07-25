import { useState } from 'react';
import { cn } from '@/lib/utils';

// Brand favicon, proxied through the worker (GET /api/favicon?domain=…) so the
// browser only ever loads a same-origin image — the strict img-src CSP forbids
// third-party favicon hosts. The proxy tries Google (256px) then DuckDuckGo
// server-side and downscales via CSS, so it stays crisp on retina.

// Favicon for a domain (URL input, brand step marker, competitor rows). Square,
// theme-aware placeholder when the icon fails — no rounded corners (DESIGN.md).
export const Favicon = ({
  domain,
  size = 16,
  className,
}: {
  domain: string;
  size?: number;
  className?: string;
}) => {
  // Track which domain failed rather than a boolean, so the failure resets
  // automatically when the same component instance renders a new domain.
  const [failedDomain, setFailedDomain] = useState<string | null>(null);
  const box = { width: size, height: size };
  const src = domain
    ? `/api/favicon?domain=${encodeURIComponent(domain)}`
    : undefined;

  if (!src || failedDomain === domain) {
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
      onError={() => setFailedDomain(domain)}
    />
  );
};
