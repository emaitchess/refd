import { type ReactNode, useId, useRef } from 'react';
import { DitherIcon } from '@/components/dither/DitherIcon';
import { useDialogFocus } from '@/hooks/useDialogFocus';
import { useOnKeyPress } from '@/lib/keyboard';
import { cn } from '@/lib/utils';

export const Modal = ({
  title,
  children,
  onClose,
  panelClassName,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  panelClassName?: string;
}) => {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  useDialogFocus(panelRef, titleRef);
  useOnKeyPress('Escape', onClose, { ignoreWhenTyping: false });

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-scrim px-3 pt-8 backdrop-blur-sm backdrop-grayscale-100 sm:px-6 sm:pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <button
        aria-label="Close dialog"
        className="absolute inset-0 animate-[overlay-fade-in_0.2s_var(--ease-house)] cursor-default motion-reduce:animate-none"
        onClick={onClose}
        type="button"
      />
      <div
        ref={panelRef}
        className={cn(
          'relative flex max-h-[calc(100dvh-4rem)] w-full max-w-md animate-[toast-in_0.25s_var(--ease-house)] flex-col overflow-hidden border border-border-strong bg-bg-elevated shadow-lg motion-reduce:animate-none sm:max-h-[76dvh]',
          panelClassName,
        )}
      >
        <header className="flex min-h-12 items-center justify-between gap-3 border-border border-b px-5">
          <h2
            ref={titleRef}
            id={titleId}
            tabIndex={-1}
            className="font-[550] text-[14px] text-primary tracking-[-0.01em] outline-none"
          >
            {title}
          </h2>
          <button
            type="button"
            className="btn-ghost h-8 px-2"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <DitherIcon name="close" size={13} />
          </button>
        </header>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
};
