import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export const Card = ({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) => <div className={cn('card', className)}>{children}</div>;
