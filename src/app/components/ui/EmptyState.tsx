import { cn } from '@/lib/utils';

export const EmptyState = ({
  title,
  hint,
  action,
  className,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  className?: string;
}) => (
  <div
    className={cn(
      'flex flex-col items-center justify-center gap-2 border border-border border-dashed py-12 text-center',
      className,
    )}
  >
    <div className="section-label">{title}</div>
    {hint ? <p className="max-w-sm text-[13px] text-muted">{hint}</p> : null}
    {action ? <div className="mt-2">{action}</div> : null}
  </div>
);
