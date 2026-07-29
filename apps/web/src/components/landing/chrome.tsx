import type { ReactNode } from 'react';
import { DitherIcon } from '@/components/dither/DitherIcon';
import { CREATE_ACCOUNT_URL, DASHBOARD_HOME_URL } from '../../consts';

export const GITHUB_URL = 'https://github.com/emaitchess/refd';

// The public site is always anonymous; every account CTA links across to the
// dashboard app on its own origin. `to` is the primary "get started" target;
// `dashUrl` is the plain dashboard entry for signed-in visitors.
export const useAccountCta = () => ({
  authed: false as boolean,
  to: CREATE_ACCOUNT_URL,
  dashUrl: DASHBOARD_HOME_URL,
  label: 'dashboard',
  openLabel: 'open dashboard',
});

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
