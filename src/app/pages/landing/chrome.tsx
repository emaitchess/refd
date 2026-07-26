import type { ReactNode } from 'react';
import { DitherIcon } from '@/components/dither/DitherIcon';
import { appUrl } from '@/lib/routes';
import { useAuth } from '@/providers/auth';

export const GITHUB_URL = 'https://github.com/emaitchess/refd';

// While /auth/me is in flight, email is null and the page shows the visitor
// CTAs; a signed-in user sees them swap to account entry points when it
// lands. The anonymous majority never waits on the auth roundtrip this way.
// Until a workspace finishes the wizard, those entry points resume
// onboarding — the same place the dashboard's RequireOnboarded guard would
// bounce to.
export const useAccountCta = () => {
  const { email, onboarded } = useAuth();
  return {
    authed: Boolean(email),
    to: appUrl(onboarded ? '/overview' : '/onboarding'),
    label: onboarded ? 'dashboard' : 'continue onboarding',
    // Hero and closing CTAs use the longer verb form.
    openLabel: onboarded ? 'open dashboard' : 'continue onboarding',
  };
};

export const SectionLabel = ({ children }: { children: ReactNode }) => (
  <p className="font-mono text-[11px] text-accent uppercase tracking-[0.16em]">
    {children}
  </p>
);

export const LandingContainer = ({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) => (
  <div
    className={`relative mx-auto w-full max-w-[1120px] border-border border-x ${className}`}
  >
    {children}
  </div>
);

export const LandingInset = ({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) => <div className={`px-5 sm:px-8 ${className}`}>{children}</div>;

// Crossfading sun/moon for theme toggles: shows the theme you'd switch to,
// rotating the outgoing icon away. The wrapping control carries the label.
export const ThemeToggleIcon = ({
  theme,
  size,
}: {
  theme: 'dark' | 'light';
  size: number;
}) => (
  <span
    aria-hidden
    className="relative inline-flex shrink-0"
    style={{ width: size, height: size }}
  >
    <DitherIcon
      name="sun"
      size={size}
      className={`landing-theme-icon absolute inset-0 ${
        theme === 'dark' ? '' : 'landing-theme-icon-out'
      }`}
    />
    <DitherIcon
      name="moon"
      size={size}
      className={`landing-theme-icon absolute inset-0 ${
        theme === 'light' ? '' : 'landing-theme-icon-out'
      }`}
    />
  </span>
);
