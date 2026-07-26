import { useState } from 'react';
import { DeleteAccountDialog } from '@/components/account/DeleteAccountDialog';
import { useOnKeyPress } from '@/lib/keyboard';
import { cn } from '@/lib/utils';

// Top-right account control: an initial chip that opens the session actions.
// Closes on outside click (invisible backdrop) or Escape. `className` sizes the
// chip to whatever it sits beside (twMerge lets a size-* override win).
export const AccountMenu = ({
  email,
  onSignOut,
  className,
}: {
  email: string;
  onSignOut: () => void;
  className?: string;
}) => {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  useOnKeyPress('Escape', () => setOpen(false), { enabled: open });
  return (
    <>
      <div className="relative">
        <button
          type="button"
          aria-label="Account"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className={cn(
            'flex size-6 items-center justify-center border border-border-strong font-mono text-[11px] text-primary lowercase transition-colors hover:bg-bg-card-hover',
            className,
          )}
        >
          {email.slice(0, 1)}
        </button>
        {open ? (
          <>
            <button
              type="button"
              aria-hidden
              tabIndex={-1}
              className="fixed inset-0 z-40 cursor-default"
              onClick={() => setOpen(false)}
            />
            {/* Padding lives on the rows, not the panel, so the session block and
              actions share one left edge and the dividers span full width. */}
            <div className="absolute top-full right-0 z-50 mt-2 min-w-52 border border-border-strong bg-bg-elevated shadow-lg">
              <div className="px-3 py-2.5">
                <p className="section-label text-muted">signed in as</p>
                <p className="wrap-break-word mt-1 font-mono text-[12px] text-primary">
                  {email}
                </p>
              </div>
              <button
                type="button"
                onClick={onSignOut}
                className="btn-ghost h-8 w-full justify-start border-border border-t px-3 text-[12px] hover:bg-bg-card-hover"
              >
                sign out
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setDeleting(true);
                }}
                className="btn-ghost h-8 w-full justify-start border-border border-t px-3 text-[12px] text-error hover:bg-bg-card-hover"
              >
                delete account
              </button>
            </div>
          </>
        ) : null}
      </div>
      {deleting ? (
        <DeleteAccountDialog onClose={() => setDeleting(false)} />
      ) : null}
    </>
  );
};
