import { DitherIcon } from '@/components/dither/DitherIcon';
import { DitherButton } from '@/components/dither-kit/button';

// Shared Back / Continue footer for every wizard step. The primary button keeps
// its label while busy and simply disables — no "saving…" label swap.
export const StepNav = ({
  onBack,
  onNext,
  nextLabel = 'continue',
  busy = false,
  nextDisabled = false,
  final = false,
}: {
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
  busy?: boolean;
  nextDisabled?: boolean;
  final?: boolean;
}) => (
  <div className="flex items-center justify-between">
    {onBack ? (
      <button
        type="button"
        className="btn-ghost gap-1.5"
        onClick={onBack}
        disabled={busy}
      >
        <DitherIcon name="arrow-left" size={12} />
        back
      </button>
    ) : (
      <span />
    )}
    {final ? (
      <DitherButton
        type="button"
        color="red"
        variant="gradient"
        bloom="off"
        className="h-10 rounded-none px-5 font-medium font-sans text-(--color-dither-button-text) text-[13px] transition-transform duration-150 active:scale-98"
        onClick={onNext}
        disabled={busy || nextDisabled}
      >
        {nextLabel}
      </DitherButton>
    ) : (
      <button
        type="button"
        className="btn-primary h-10 px-5"
        onClick={onNext}
        disabled={busy || nextDisabled}
      >
        {nextLabel}
        <kbd className="kbd kbd-invert">↵</kbd>
      </button>
    )}
  </div>
);
