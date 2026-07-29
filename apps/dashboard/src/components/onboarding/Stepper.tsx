import { Favicon } from '@/components/ui';
import { ONBOARDING_STEPS, STEP_LABELS, stepIndex } from '@/lib/onboarding';
import type { OnboardingStep } from '@/lib/types';
import { cn } from '@/lib/utils';

export const Stepper = ({
  current,
  brandDomain,
  canSelect,
  onSelect,
  disabled = false,
}: {
  current: OnboardingStep;
  brandDomain?: string;
  canSelect: (step: OnboardingStep) => boolean;
  onSelect: (step: OnboardingStep) => void;
  disabled?: boolean;
}) => {
  const activeIndex = stepIndex(current);
  return (
    <ol className="grid w-full grid-cols-5" aria-label="Onboarding progress">
      {ONBOARDING_STEPS.map((step, index) => {
        const state =
          index < activeIndex
            ? 'done'
            : index === activeIndex
              ? 'active'
              : 'todo';
        const brandIcon = step === 'brand' && !!brandDomain;
        const selectable = !disabled && state !== 'active' && canSelect(step);
        return (
          <li
            key={step}
            aria-current={state === 'active' ? 'step' : undefined}
            aria-label={`${STEP_LABELS[step]}: ${
              state === 'done'
                ? 'complete'
                : state === 'active'
                  ? 'in progress'
                  : selectable
                    ? 'available'
                    : 'up next'
            }`}
            className={cn(
              'h-14 min-w-0 border-border border-r last:border-r-0 sm:h-16',
              state === 'active' && 'bg-accent-soft',
            )}
          >
            <button
              type="button"
              disabled={!selectable}
              onClick={() => onSelect(step)}
              className={cn(
                'flex h-full w-full items-center gap-2 px-2 text-left transition-colors sm:px-4',
                selectable
                  ? 'cursor-pointer hover:bg-bg-card-hover'
                  : 'cursor-default',
              )}
            >
              <span
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center overflow-hidden border font-mono text-[10px]',
                  brandIcon
                    ? 'border-border-strong bg-bg-elevated'
                    : state === 'active'
                      ? 'border-accent bg-accent-soft text-accent'
                      : state === 'done'
                        ? 'border-accent/45 bg-accent-soft text-accent'
                        : 'border-border text-muted',
                )}
              >
                {brandIcon ? (
                  <Favicon domain={brandDomain} size={14} />
                ) : (
                  String(index + 1).padStart(2, '0')
                )}
              </span>
              <span className="hidden min-w-0 sm:flex sm:flex-col">
                <span
                  className={cn(
                    'truncate font-mono text-[10px] uppercase tracking-[0.12em]',
                    state === 'todo' ? 'text-muted' : 'text-primary',
                  )}
                >
                  {STEP_LABELS[step]}
                </span>
                <span className="mt-0.5 font-mono text-[10px] text-muted">
                  {state === 'done'
                    ? 'complete'
                    : state === 'active'
                      ? 'in progress'
                      : selectable
                        ? 'available'
                        : 'up next'}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
};
