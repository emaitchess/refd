import { DitherIcon } from '@/components/dither/DitherIcon';
import { Favicon } from '@/components/ui';

// Brand name + favicon (higher-res via the Favicon component), falling back to
// the app glyph when there's no domain.
export const BrandMark = ({
  name,
  domain,
}: {
  name: string;
  domain?: string;
}) => (
  <div className="flex min-w-0 items-center gap-3">
    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden border border-border bg-bg-elevated">
      {domain ? (
        <Favicon key={domain} domain={domain} size={24} />
      ) : (
        <DitherIcon name="logo" size={18} className="text-muted" />
      )}
    </div>
    <div className="flex min-w-0 flex-col">
      <span className="truncate font-[550] text-[14px] text-primary tracking-[-0.01em]">
        {name || 'your brand'}
      </span>
      {domain ? (
        <span className="truncate font-mono text-[11px] text-muted">
          {domain}
        </span>
      ) : null}
    </div>
  </div>
);
