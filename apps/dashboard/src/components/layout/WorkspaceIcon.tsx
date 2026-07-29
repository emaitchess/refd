import { Favicon } from '@/components/ui';
import { cn } from '@/lib/utils';

// A workspace's mark: its brand favicon once a domain exists, else the initial.
// The letter is the honest fallback — a workspace mid-onboarding has no brand
// yet, and an empty box would read as a broken image.
export const WorkspaceIcon = ({
  name,
  domain,
  size = 16,
  className,
}: {
  name: string;
  domain?: string | null;
  size?: number;
  className?: string;
}) => {
  if (domain) {
    return <Favicon domain={domain} size={size} className={className} />;
  }
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={cn(
        'flex shrink-0 items-center justify-center border border-border-strong font-mono text-[10px] text-primary lowercase',
        className,
      )}
    >
      {(name || '?').slice(0, 1)}
    </span>
  );
};
