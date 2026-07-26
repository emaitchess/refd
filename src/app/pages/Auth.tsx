import { Dithering } from '@paper-design/shaders-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import { DitherIcon } from '@/components/dither/DitherIcon';
import { DitherButton } from '@/components/dither-kit/button';
import { DitherGradient } from '@/components/dither-kit/gradient';
import { Tooltip } from '@/components/dither-kit/tooltip';
import { SurfaceLogo } from '@/components/svgs/SurfaceLogo';
import { PasswordInput } from '@/components/ui';
import { BRANDED_THEME_TOKENS } from '@/lib/branded-theme';
import { SURFACE_ORDER, surfaceLabel } from '@/lib/format';
import { CREATE_ACCOUNT_PATH, SIGN_IN_PATH } from '@/lib/routes';
import { useTheme } from '@/lib/theme';
import { useAuth } from '@/providers/auth';

const AuthDither = ({ theme }: { theme: 'dark' | 'light' }) => {
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 ${
        theme === 'dark' ? 'opacity-65' : 'opacity-50'
      }`}
    >
      <Dithering
        className="h-full w-full"
        colorBack="#00000000"
        colorFront={theme === 'dark' ? '#361118' : '#dcaeb5'}
        scale={1}
        shape="warp"
        size={2}
        speed={still ? 0 : 0.2}
        type="2x2"
      />
      <div
        className={`absolute inset-0 ${
          theme === 'dark'
            ? 'bg-[radial-gradient(ellipse_at_48%_42%,rgba(8,8,9,0.12)_0%,rgba(8,8,9,0.46)_58%,rgba(8,8,9,0.9)_100%)]'
            : 'bg-[radial-gradient(ellipse_at_48%_42%,rgba(247,244,240,0.16)_0%,rgba(247,244,240,0.52)_58%,rgba(247,244,240,0.92)_100%)]'
        }`}
      />
    </div>
  );
};

const AuthRail = ({ children }: { children: ReactNode }) => (
  <div className="mx-auto w-full max-w-[1120px] border-border border-x">
    {children}
  </div>
);

export const Auth = () => {
  const { email: sessionEmail, loading, login, register } = useAuth();
  const location = useLocation();
  const [theme, toggleTheme] = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const registering = location.pathname === CREATE_ACCOUNT_PATH;

  const clearTransient = () => {
    setConfirm('');
    setConfirmError(null);
    setError(null);
  };

  if (!loading && sessionEmail) {
    return <Navigate to="/home" replace />;
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (registering && password !== confirm) {
      setConfirmError('Passwords do not match.');
      return;
    }
    setBusy(true);
    setConfirmError(null);
    setError(null);
    try {
      await (registering ? register(email, password) : login(email, password));
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : registering
            ? 'Registration failed.'
            : 'Sign in failed.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="auth-shell flex min-h-svh flex-col overflow-x-hidden bg-bg text-primary"
      style={BRANDED_THEME_TOKENS[theme]}
    >
      <header className="shrink-0 border-border border-b">
        <AuthRail>
          <div className="flex h-14 items-center justify-between px-5 sm:px-8 md:h-17">
            <Link
              to="/"
              className="flex items-center gap-2.5"
              aria-label="refd home"
            >
              <DitherIcon name="logo" size={20} className="text-primary" />
              <span className="font-mono text-[15px] text-primary">refd</span>
            </Link>
            <Link
              to="/"
              className="hidden items-center gap-2 text-[12px] text-secondary transition-colors duration-150 hover:text-primary sm:flex"
            >
              <DitherIcon name="arrow-left" size={12} />
              home
            </Link>
          </div>
        </AuthRail>
      </header>

      <main className="flex flex-1 border-border border-b">
        <AuthRail>
          <div className="grid min-h-full lg:grid-cols-[1.15fr_0.85fr]">
            <section className="relative hidden overflow-hidden border-border lg:flex lg:flex-col lg:border-r">
              <AuthDither theme={theme} />
              <div className="relative z-1 flex flex-1 items-center px-5 py-20 sm:px-8">
                <div className="max-w-[560px]">
                  <p className="font-mono text-[11px] text-accent uppercase tracking-[0.16em]">
                    open-source ai search monitoring
                  </p>
                  <p className="mt-7 text-balance font-[480] text-[50px] leading-[1.02] tracking-[-0.045em] xl:text-[58px]">
                    Know where you show up. Keep the receipts.
                  </p>
                  <p className="mt-7 max-w-[520px] text-[15px] text-secondary leading-[1.7]">
                    Monitor visibility, citations, and position across the AI
                    platforms your buyers use. Every metric stays connected to
                    the prompt and raw answer behind it.
                  </p>
                  <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3 text-secondary">
                    {SURFACE_ORDER.map((surface) => (
                      <span key={surface} className="flex items-center gap-2">
                        <SurfaceLogo surface={surface} className="size-4" />
                        <span className="sr-only">{surfaceLabel(surface)}</span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="relative z-1 grid grid-cols-3 border-border border-t bg-bg/45 backdrop-blur-sm">
                {[
                  ['05', 'ai surfaces'],
                  ['daily', 'monitoring'],
                  ['raw', 'answer archive'],
                ].map(([value, label], index) => (
                  <div
                    key={label}
                    className={`px-5 py-5 sm:px-8 ${index ? 'border-border border-l' : ''}`}
                  >
                    <p className="font-mono text-[13px] text-primary">
                      {value}
                    </p>
                    <p className="mt-1 font-mono text-[10px] text-muted uppercase tracking-widest">
                      {label}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            <section className="flex items-center bg-bg-elevated/35 px-5 py-12 sm:px-8 sm:py-16">
              <div className="mx-auto w-full max-w-[420px]">
                <div className="lg:hidden">
                  <p className="font-mono text-[10px] text-accent uppercase tracking-[0.16em]">
                    ai search monitoring
                  </p>
                  <p className="mt-4 max-w-[390px] text-[24px] leading-[1.12] tracking-[-0.03em] sm:text-[28px]">
                    Visibility metrics with the raw answers attached.
                  </p>
                </div>

                <div className="mt-10 grid grid-cols-2 border border-border lg:mt-0">
                  <Link
                    to={SIGN_IN_PATH}
                    onClick={clearTransient}
                    aria-current={!registering ? 'page' : undefined}
                    className={`h-10 cursor-pointer font-medium text-[13px] transition-colors duration-150 ${
                      registering
                        ? 'text-muted hover:bg-bg-card-hover hover:text-primary'
                        : 'bg-accent-soft text-primary'
                    } flex items-center justify-center`}
                  >
                    sign in
                  </Link>
                  <Link
                    to={CREATE_ACCOUNT_PATH}
                    onClick={clearTransient}
                    aria-current={registering ? 'page' : undefined}
                    className={`h-10 cursor-pointer border-border border-l font-medium text-[13px] transition-colors duration-150 ${
                      registering
                        ? 'bg-accent-soft text-primary'
                        : 'text-muted hover:bg-bg-card-hover hover:text-primary'
                    } flex items-center justify-center`}
                  >
                    start monitoring
                  </Link>
                </div>

                <div className="mt-10">
                  <p className="font-mono text-[10px] text-accent uppercase tracking-[0.16em]">
                    {registering ? 'create your workspace' : 'welcome back'}
                  </p>
                  <h1 className="mt-4 text-[34px] leading-[1.08] tracking-[-0.035em] sm:text-[38px]">
                    {registering ? 'Start monitoring.' : 'Sign in to refd.'}
                  </h1>
                  <p className="mt-4 text-[14px] text-secondary leading-[1.65]">
                    {registering
                      ? 'Use your work email. You will choose your brand, competitors, and tracked questions next.'
                      : 'Continue to your latest AI search visibility data.'}
                  </p>
                </div>

                <form onSubmit={submit} className="mt-8 flex flex-col gap-5">
                  <label className="flex flex-col gap-2">
                    <span className="font-mono text-[10px] text-secondary uppercase tracking-[0.12em]">
                      work email
                    </span>
                    <input
                      className="input h-11 bg-bg-elevated"
                      type="email"
                      autoComplete="username"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      autoFocus
                      required
                    />
                    {registering ? (
                      <span className="text-[11px] text-muted">
                        Business email addresses only.
                      </span>
                    ) : null}
                  </label>
                  <div className="flex flex-col gap-2">
                    <label
                      htmlFor="auth-password"
                      className="flex items-center justify-between font-mono text-[10px] text-secondary uppercase tracking-[0.12em]"
                    >
                      password
                      {registering ? (
                        <span className="text-muted normal-case tracking-normal">
                          8 characters minimum
                        </span>
                      ) : null}
                    </label>
                    <PasswordInput
                      id="auth-password"
                      className="input h-11 bg-bg-elevated"
                      autoComplete={
                        registering ? 'new-password' : 'current-password'
                      }
                      minLength={registering ? 8 : undefined}
                      value={password}
                      onChange={(event) => {
                        setPassword(event.target.value);
                        setConfirmError(null);
                      }}
                      required
                    />
                  </div>
                  {registering ? (
                    <div className="flex flex-col gap-2">
                      <label
                        htmlFor="auth-confirm-password"
                        className="font-mono text-[10px] text-secondary uppercase tracking-[0.12em]"
                      >
                        confirm password
                      </label>
                      <PasswordInput
                        id="auth-confirm-password"
                        className="input h-11 bg-bg-elevated"
                        autoComplete="new-password"
                        minLength={8}
                        value={confirm}
                        onChange={(event) => {
                          setConfirm(event.target.value);
                          setConfirmError(null);
                        }}
                        aria-invalid={Boolean(confirmError)}
                        aria-describedby={
                          confirmError ? 'confirm-password-error' : undefined
                        }
                        required
                      />
                      {confirmError ? (
                        <span
                          id="confirm-password-error"
                          role="alert"
                          className="text-[11px] text-error"
                        >
                          {confirmError}
                        </span>
                      ) : null}
                    </div>
                  ) : null}

                  {error ? (
                    <p
                      role="alert"
                      className="border-error/40 border-l-2 bg-error/5 px-3 py-2 text-[12px] text-error leading-normal"
                    >
                      {error}
                    </p>
                  ) : null}

                  {registering ? (
                    <DitherButton
                      type="submit"
                      color="red"
                      variant="gradient"
                      bloom="off"
                      disabled={busy}
                      className="h-11 w-full rounded-none px-5 font-medium font-sans text-(--color-dither-button-text) text-[13px] transition-transform duration-150 active:scale-98"
                    >
                      {busy ? 'creating workspace…' : 'start monitoring'}
                    </DitherButton>
                  ) : (
                    <button
                      type="submit"
                      className="inline-flex h-11 w-full cursor-pointer items-center justify-center bg-primary px-5 font-medium text-[13px] text-bg transition-transform duration-150 active:scale-98 disabled:cursor-default disabled:opacity-50"
                      disabled={busy}
                    >
                      {busy ? 'signing in…' : 'sign in'}
                    </button>
                  )}
                </form>

                <Link
                  to={registering ? SIGN_IN_PATH : CREATE_ACCOUNT_PATH}
                  onClick={clearTransient}
                  className="mt-6 block w-full cursor-pointer text-center text-[12px] text-secondary transition-colors duration-150 hover:text-primary"
                >
                  {registering
                    ? 'Already have an account? Sign in'
                    : 'New to refd? Start monitoring'}
                </Link>
              </div>
            </section>
          </div>
        </AuthRail>
      </main>

      <footer className="shrink-0 border-border border-b">
        <AuthRail>
          <div className="relative overflow-hidden">
            <DitherGradient
              from="red"
              to="transparent"
              direction="up"
              cell={3}
              opacity={theme === 'dark' ? 0.12 : 0.06}
              bloom="off"
            />
            <div className="relative z-1 flex min-h-14 items-center justify-between gap-4 px-5 py-4 sm:px-8">
              <p className="font-mono text-[10px] text-muted uppercase tracking-widest">
                open-source ai search monitoring
              </p>
              <div className="flex items-center gap-5">
                <p className="hidden font-mono text-[10px] text-muted md:block">
                  monitor · compare · verify
                </p>
                <Tooltip
                  asChild
                  content={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
                  className="border-border-strong bg-bg-elevated text-primary shadow-lg"
                >
                  <button
                    type="button"
                    onClick={toggleTheme}
                    className="flex cursor-pointer items-center gap-2 font-mono text-[10px] text-muted uppercase tracking-[0.08em] transition-colors duration-150 hover:text-primary"
                    aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
                  >
                    <DitherIcon
                      name={theme === 'dark' ? 'sun' : 'moon'}
                      size={12}
                    />
                  </button>
                </Tooltip>
              </div>
            </div>
          </div>
        </AuthRail>
      </footer>
    </div>
  );
};
