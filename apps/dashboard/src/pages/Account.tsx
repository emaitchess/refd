import { type FormEvent, useState } from 'react';
import { DeleteAccountDialog } from '@/components/account/DeleteAccountDialog';
import { useToast } from '@/components/feedback/Toast';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, PasswordInput } from '@/components/ui';
import { api, useAsyncAction } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth';

const PanelHeader = ({
  title,
  description,
}: {
  title: string;
  description: string;
}) => (
  <header className="flex min-h-24 flex-col justify-center border-border border-b bg-bg-elevated px-5 py-3">
    <h2 className="section-label text-primary">{title}</h2>
    <p className="mt-1 text-[12px] text-muted leading-relaxed">{description}</p>
  </header>
);

const ProfileCard = () => {
  const { email, firstName, lastName, updateProfile } = useAuth();
  const [first, setFirst] = useState(firstName ?? '');
  const [last, setLast] = useState(lastName ?? '');
  const { busy, error, run } = useAsyncAction();
  const toast = useToast();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await updateProfile(first, last);
      toast('profile updated');
    });
  };

  return (
    <Card className="flex h-full flex-col overflow-hidden p-0">
      <PanelHeader
        title="profile"
        description="The person responsible for this refd account. Names are optional."
      />
      <form onSubmit={submit} className="flex flex-1 flex-col p-5">
        <div className="border border-border">
          <div className="flex min-h-16 items-center gap-4 px-4 py-3">
            <div className="min-w-0">
              <div className="field-label">account email</div>
              <div className="mt-1 truncate text-[13px] text-primary">
                {email}
              </div>
            </div>
          </div>
          <div className="grid border-border border-t sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 px-4 py-3 sm:border-border sm:border-r">
              <span className="field-label">first name</span>
              <input
                className="input h-9"
                autoComplete="given-name"
                maxLength={80}
                placeholder="optional"
                value={first}
                onChange={(event) => setFirst(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1.5 border-border border-t px-4 py-3 sm:border-t-0">
              <span className="field-label">last name</span>
              <input
                className="input h-9"
                autoComplete="family-name"
                maxLength={80}
                placeholder="optional"
                value={last}
                onChange={(event) => setLast(event.target.value)}
              />
            </label>
          </div>
        </div>
        {error ? (
          <p className="mt-3 text-[13px] text-error" aria-live="polite">
            {error}
          </p>
        ) : null}
        <div className="mt-auto pt-4">
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'saving…' : 'save profile'}
          </button>
        </div>
      </form>
    </Card>
  );
};

const PasswordCard = () => {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (next !== confirm) {
      setMessage({ ok: false, text: 'new passwords do not match' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await api('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      setCurrent('');
      setNext('');
      setConfirm('');
      setMessage({
        ok: true,
        text: 'password changed, other sessions signed out',
      });
    } catch (cause) {
      setMessage({
        ok: false,
        text: cause instanceof Error ? cause.message : 'failed',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex h-full flex-col overflow-hidden p-0">
      <PanelHeader
        title="password"
        description="Change your sign-in password and revoke every other active session."
      />
      <form onSubmit={submit} className="flex flex-1 flex-col p-5">
        <div className="border border-border">
          <label
            htmlFor="account-current-password"
            className="flex flex-col gap-1.5 px-4 py-3"
          >
            <span className="field-label">current password</span>
            <PasswordInput
              id="account-current-password"
              className="input h-9"
              autoComplete="current-password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
              required
            />
          </label>
          <label
            htmlFor="account-new-password"
            className="flex flex-col gap-1.5 border-border border-t px-4 py-3"
          >
            <span className="field-label">new password</span>
            <PasswordInput
              id="account-new-password"
              className="input h-9"
              autoComplete="new-password"
              minLength={8}
              value={next}
              onChange={(event) => setNext(event.target.value)}
              required
            />
          </label>
          <label
            htmlFor="account-confirm-password"
            className="flex flex-col gap-1.5 border-border border-t px-4 py-3"
          >
            <span className="field-label">confirm new password</span>
            <PasswordInput
              id="account-confirm-password"
              className="input h-9"
              autoComplete="new-password"
              minLength={8}
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              required
            />
          </label>
        </div>
        <p className="mt-2 text-[11px] text-muted">
          Use at least 8 characters. This browser remains signed in.
        </p>
        {message ? (
          <p
            aria-live="polite"
            className={cn(
              'mt-3 text-[13px]',
              message.ok ? 'text-success' : 'text-error',
            )}
          >
            {message.text}
          </p>
        ) : null}
        <div className="mt-auto pt-4">
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'changing…' : 'change password'}
          </button>
        </div>
      </form>
    </Card>
  );
};

const DeleteAccount = () => {
  const { email } = useAuth();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Card className="overflow-hidden p-0">
        <div className="flex flex-col justify-between gap-5 p-5 sm:flex-row sm:items-center">
          <div>
            <h2 className="section-label text-error">delete account</h2>
            <p className="mt-1 max-w-3xl text-[12px] text-muted leading-relaxed">
              Permanently delete {email}, every workspace it owns, all reports,
              and stored raw answers. This cannot be undone.
            </p>
          </div>
          <button
            type="button"
            className="btn-secondary shrink-0 text-error"
            onClick={() => setOpen(true)}
          >
            delete account
          </button>
        </div>
      </Card>

      {open ? <DeleteAccountDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
};

export const Account = () => (
  <>
    <PageHeader
      title="Account"
      description="Manage your profile, sign-in security, and account lifecycle."
    />
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 items-stretch gap-4 xl:grid-cols-2">
        <ProfileCard />
        <PasswordCard />
      </div>
      <DeleteAccount />
    </div>
  </>
);
