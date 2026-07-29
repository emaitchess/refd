import { useState } from 'react';
import { apiOrigin } from '@/lib/api';
import { cn } from '@/lib/utils';

// Brand favicon, proxied through the API Worker (GET /favicon?domain=…): the
// strict img-src CSP forbids third-party favicon hosts, so it loads from the API
// origin instead (credentialed, since the proxy is session-gated). The proxy
// tries Google (256px) then DuckDuckGo server-side and downscales via CSS.

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
    ? `${apiOrigin()}/favicon?domain=${encodeURIComponent(domain)}`
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
      // Session cookie must ride the cross-origin request to the API proxy.
      crossOrigin="use-credentials"
      className={cn('favicon-contrast shrink-0 object-contain', className)}
      style={box}
      onError={() => setFailedDomain(domain)}
    />
  );
};
