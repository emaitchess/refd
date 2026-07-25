import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type BadgeTone = 'ok' | 'info' | 'fail' | 'neutral';

export const Badge = ({
  tone,
  children,
}: {
  tone: BadgeTone;
  children: ReactNode;
}) => (
  <span
    className={cn(
      'inline-flex items-center px-1.5 py-0.5 font-mono text-[11px] tracking-[0.04em]',
      tone === 'ok' && 'bg-success/10 text-success',
      tone === 'info' && 'bg-info/10 text-info',
      tone === 'fail' && 'bg-error/10 text-error',
      tone === 'neutral' && 'bg-accent-soft text-muted',
    )}
  >
    {children}
  </span>
);
