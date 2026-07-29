import { type ComponentProps, useState } from 'react';
import { DitherIcon } from '@/components/dither/DitherIcon';
import { Tooltip } from '@/components/dither-kit/tooltip';
import { cn } from '@/lib/utils';

type PasswordInputProps = Omit<ComponentProps<'input'>, 'type'>;

export const PasswordInput = ({ className, ...props }: PasswordInputProps) => {
  const [visible, setVisible] = useState(false);
  const label = visible ? 'Hide password' : 'Show password';

  return (
    <div className="relative">
      <input
        {...props}
        type={visible ? 'text' : 'password'}
        className={cn(className, 'pr-11')}
      />
      {props.value && (
        <Tooltip
          asChild
          content={label}
          className="border-border-strong bg-bg-elevated text-primary shadow-lg"
        >
          <button
            type="button"
            onClick={() => setVisible((current) => !current)}
            className={cn(
              'absolute inset-y-px right-px flex w-10 cursor-pointer items-center justify-center text-muted transition-colors duration-150 hover:bg-accent-soft hover:text-primary',
              visible && 'text-primary',
            )}
            aria-label={label}
            aria-pressed={visible}
          >
            <DitherIcon name={visible ? 'eye-off' : 'eye'} size={14} />
          </button>
        </Tooltip>
      )}
    </div>
  );
};
