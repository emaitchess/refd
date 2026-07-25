import type { ReactNode } from 'react';
import {
  DitherIcon,
  type DitherIconName,
} from '@/components/dither/DitherIcon';
import { Dots } from '@/components/feedback/Dots';
import { STEP_LABELS, stepIndex } from '@/lib/onboarding';
import type { OnboardingStep } from '@/lib/types';
import { OnboardingScrollArea } from './OnboardingScrollArea';

export const StepCard = ({
  step,
  title,
  icon,
  action,
  error,
  footer,
  children,
}: {
  step: OnboardingStep;
  title: string;
  icon?: DitherIconName;
  action?: ReactNode;
  error?: string | null;
  footer?: ReactNode;
  children: ReactNode;
}) => (
  <article className="flex min-h-full min-w-0 flex-col bg-bg-elevated/25 lg:h-full lg:min-h-0">
    <div className="flex flex-col items-start justify-between gap-5 border-border border-b px-5 py-9 sm:flex-row sm:px-8 sm:py-11 lg:py-14">
      <div className="min-w-0">
        <div className="flex items-center gap-2.5 font-mono text-[10px] text-accent uppercase tracking-[0.16em]">
          {icon ? <DitherIcon name={icon} size={14} /> : null}
          <span>
            {String(stepIndex(step) + 1).padStart(2, '0')} / 05 ·{' '}
            {STEP_LABELS[step]}
          </span>
        </div>
        <h1 className="mt-5 max-w-[560px] text-balance font-medium text-[30px] text-primary leading-[1.08] tracking-[-0.035em] sm:text-[38px]">
          {title}
        </h1>
      </div>
      <div className="shrink-0 pt-0.5">{action}</div>
    </div>
    <OnboardingScrollArea
      label="Scroll step content"
      className="flex min-w-0 flex-1 lg:min-h-0"
      viewportClassName="flex min-w-0 flex-1 px-5 pt-8 sm:px-8 sm:pt-10 lg:min-h-0"
      contentClassName="flex min-h-full min-w-0 flex-1 flex-col"
      scrollbarClassName="hidden lg:block"
    >
      <div className="flex min-w-0 flex-col gap-6">{children}</div>
      <div aria-hidden className="h-5 shrink-0 sm:h-8" />
    </OnboardingScrollArea>
    {footer || error ? (
      <div className="flex flex-col gap-3 border-border border-t px-5 pt-5 sm:px-8">
        {error ? (
          <p
            role="alert"
            className="border-error/40 border-l-2 bg-error/5 px-3 py-2 text-[12px] text-error"
          >
            {error}
          </p>
        ) : null}
        {footer}
      </div>
    ) : null}
    <div aria-hidden className="h-5 shrink-0 sm:h-8" />
  </article>
);

export const RegenerateAction = ({
  loading,
  loadingLabel,
  label = 'regenerate',
  onClick,
  disabled = false,
}: {
  loading: boolean;
  loadingLabel: string;
  label?: string;
  onClick: () => void;
  disabled?: boolean;
}) => (
  <button
    type="button"
    className="btn-ghost inline-flex h-8 shrink-0 items-center gap-1.5 border border-border px-2.5 text-[11px]"
    onClick={onClick}
    disabled={loading || disabled}
  >
    {loading ? (
      <>
        <span className="dither-live text-[8px]">■</span>
        {loadingLabel}
        <Dots />
      </>
    ) : (
      label
    )}
  </button>
);
