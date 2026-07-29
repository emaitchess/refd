import { cn } from '@/lib/utils';
import { OverflowTooltip } from './OverflowTooltip';

// Citation URL with the domain emphasized over the path; opens in a new tab.
//
// These URLs come from scraped AI answers, so the scheme is checked before one
// reaches an href — anything but http(s) (javascript:, data:) renders as inert
// text. rel="noreferrer nofollow" keeps our URLs out of their referer logs and
// withholds ranking signal from a source we don't vouch for.
export const CitationUrl = ({
  url,
  className,
}: {
  url: string;
  className?: string;
}) => {
  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    parsed = null;
  }

  if (
    !parsed ||
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
  ) {
    return (
      <OverflowTooltip
        content={url}
        delay={400}
        className="max-w-[min(32rem,calc(100vw-1.5rem))] whitespace-normal break-all border-border-strong bg-bg-elevated text-primary shadow-lg"
      >
        <span
          className={cn(
            'truncate font-mono text-[12px] text-secondary',
            className,
          )}
        >
          {url}
        </span>
      </OverflowTooltip>
    );
  }

  const host = parsed.hostname.replace(/^www\./, '');
  const rest = `${parsed.pathname}${parsed.search}`.replace(/\/$/, '');
  return (
    <OverflowTooltip
      content={url}
      delay={400}
      className="max-w-[min(32rem,calc(100vw-1.5rem))] whitespace-normal break-all border-border-strong bg-bg-elevated text-primary shadow-lg"
    >
      <a
        href={url}
        target="_blank"
        rel="noreferrer nofollow"
        className={cn(
          'truncate font-mono text-[12px] transition-colors hover:underline',
          className,
        )}
      >
        <span className="text-primary">{host}</span>
        <span className="text-muted">{rest}</span>
      </a>
    </OverflowTooltip>
  );
};
