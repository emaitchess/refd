import { DitherIcon } from '@/components/dither/DitherIcon';
import { DitherGradient } from '@/components/dither-kit/gradient';
import { useTheme } from '@/lib/theme';
import { SIGN_IN_URL } from '../../consts';
import {
  GITHUB_URL,
  LandingContainer,
  LandingInset,
  ThemeToggleIcon,
  useAccountCta,
} from './chrome';

export const Footer = () => {
  const { authed, to, label } = useAccountCta();
  const [theme, toggleTheme] = useTheme();

  return (
    <footer className="border-border border-b">
      <LandingContainer className="overflow-hidden">
        <DitherGradient
          from="red"
          to="transparent"
          direction="up"
          cell={3}
          opacity={theme === 'dark' ? 0.12 : 0.06}
          bloom="off"
        />
        <LandingInset className="relative z-1 flex flex-col gap-5 py-8 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2.5">
            <DitherIcon name="logo" size={16} className="text-primary" />
            <span className="font-mono text-[11px] text-primary">refd</span>
            <span className="font-mono text-[10px] text-muted">
              open-source ai search monitoring
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-x-5 gap-y-3 font-mono text-[10px] text-muted uppercase tracking-[0.08em]">
            <a href="/methodology" className="hover:text-primary">
              methodology
            </a>
            <a href="/docs" className="hover:text-primary">
              docs
            </a>
            <a href="/blog" className="hover:text-primary">
              blog
            </a>
            <a href="/agents" className="hover:text-primary">
              agents
            </a>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="group hover:text-primary"
            >
              github{' '}
              <span
                aria-hidden
                className="inline-block transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transition-none"
              >
                ↗
              </span>
            </a>
            {authed ? (
              <a href={to} className="hover:text-primary">
                {label}
              </a>
            ) : (
              <a href={SIGN_IN_URL} className="hover:text-primary">
                sign in
              </a>
            )}
            <button
              type="button"
              onClick={toggleTheme}
              className="flex cursor-pointer items-center gap-2 hover:text-primary"
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            >
              <ThemeToggleIcon theme={theme} size={12} />
            </button>
          </div>
        </LandingInset>
      </LandingContainer>
    </footer>
  );
};
