import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import { useToast } from '@/components/feedback/Toast';
import { Modal, PasswordInput } from '@/components/ui';
import { useAsyncAction } from '@/lib/api';
import { SIGN_IN_PATH } from '@/lib/routes';
import { useAuth } from '@/providers/auth';

export const DeleteAccountDialog = ({ onClose }: { onClose: () => void }) => {
  const { deleteAccount } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const { busy, error, run } = useAsyncAction();
  const confirmationMatches =
    confirmation.trim().toLowerCase() === 'delete my account';

  const close = () => {
    if (!busy) {
      onClose();
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await deleteAccount(password, confirmation);
      navigate(SIGN_IN_PATH, { replace: true });
    });
  };

  const copyConfirmation = async () => {
    try {
      await navigator.clipboard.writeText('delete my account');
      toast('confirmation phrase copied');
    } catch {
      toast('could not copy confirmation phrase');
    }
  };

  return (
    <Modal title="Delete your account?" onClose={close}>
      <form onSubmit={submit}>
        <p className="text-[13px] text-secondary leading-relaxed">
          This permanently removes every workspace and all monitoring data owned
          by this account.
        </p>
        <label
          htmlFor="delete-account-password"
          className="mt-4 flex flex-col gap-1.5"
        >
          <span className="field-label">current password</span>
          <PasswordInput
            id="delete-account-password"
            className="input h-9"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            autoFocus
          />
        </label>
        <div className="mt-3 flex flex-col gap-1.5">
          <label htmlFor="delete-account-confirmation" className="field-label">
            confirmation phrase
          </label>
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] text-secondary normal-case">
              Type “delete my account” to confirm.
            </span>
            <button
              type="button"
              className="btn-ghost h-6 shrink-0 px-1.5 font-mono text-[10px]"
              onClick={() => void copyConfirmation()}
            >
              copy
            </button>
          </div>
          <input
            id="delete-account-confirmation"
            className="input h-9"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            required
            autoComplete="off"
          />
        </div>
        {error ? (
          <p className="mt-3 text-[13px] text-error" aria-live="polite">
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={close}
            disabled={busy}
          >
            cancel
          </button>
          <button
            type="submit"
            className="btn-secondary text-error"
            disabled={busy || !password || !confirmationMatches}
          >
            {busy ? 'deleting…' : 'delete permanently'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
