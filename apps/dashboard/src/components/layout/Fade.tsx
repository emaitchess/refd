import { cn } from '@/lib/utils';

// Sidebar collapse labels fade in place; the rail's overflow-hidden clips them
// during the width animation so nothing reflows.
export const Fade = ({
  show,
  className,
  children,
}: {
  show: boolean;
  className?: string;
  children: React.ReactNode;
}) => (
  <span
    className={cn(
      'overflow-hidden whitespace-nowrap transition-opacity duration-200 ease-house',
      show ? 'opacity-100' : 'opacity-0',
      className,
    )}
  >
    {children}
  </span>
);
