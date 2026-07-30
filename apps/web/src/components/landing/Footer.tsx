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

const productLinks = [
  { href: '/#platform', label: 'platform' },
  { href: '/#signals', label: 'signals' },
  { href: '/demo', label: 'interactive demo' },
  { href: '/open-source', label: 'open source' },
];

const resourceLinks = [
  { href: '/methodology', label: 'methodology' },
  { href: '/docs', label: 'documentation' },
  { href: '/blog', label: 'blog' },
  { href: '/agents', label: 'agent access' },
];

const trustLinks = [
  { href: '/security', label: 'security' },
  { href: '/support', label: 'support' },
  { href: '/privacy', label: 'privacy' },
  { href: '/terms', label: 'terms' },
];

const FooterLinks = ({
  title,
  links,
}: {
  title: string;
  links: { href: string; label: string; external?: boolean }[];
}) => (
  <nav aria-label={`${title} footer links`}>
    <p className="font-mono text-[10px] text-muted uppercase tracking-[0.16em]">
      {title}
    </p>
    <div className="mt-6 flex flex-col items-start gap-3.5 text-[14px] text-secondary sm:text-[15px]">
      {links.map((link) => (
        <a
          key={link.href}
          href={link.href}
          target={link.external ? '_blank' : undefined}
          rel={link.external ? 'noreferrer' : undefined}
          className="group transition-colors duration-150 hover:text-primary motion-reduce:transition-none"
        >
          {link.label}
          {link.external && (
            <span
              aria-hidden
              className="ml-1.5 inline-block transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transition-none"
            >
              ↗
            </span>
          )}
        </a>
      ))}
    </div>
  </nav>
);

export const Footer = () => {
  const { authed, to, label } = useAccountCta();
  const [theme, toggleTheme] = useTheme();
  const connectLinks = [
    { href: to, label: 'start monitoring' },
    {
      href: authed ? to : SIGN_IN_URL,
      label: authed ? label : 'sign in',
    },
    { href: GITHUB_URL, label: 'GitHub', external: true },
    { href: 'mailto:h@emaitchess.com', label: 'contact' },
  ];

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
        <LandingInset className="relative z-1 grid gap-x-10 gap-y-12 py-12 sm:grid-cols-2 lg:grid-cols-[1.5fr_repeat(4,minmax(0,1fr))] lg:gap-x-10 lg:py-16">
          <div className="sm:col-span-2 lg:col-span-1">
            <a
              href="/"
              aria-label="refd home"
              className="inline-flex items-center gap-2.5"
            >
              <DitherIcon name="logo" size={18} className="text-primary" />
              <span className="font-mono text-[14px] text-primary">refd</span>
            </a>
            <p className="mt-7 max-w-[300px] text-[15px] text-secondary leading-7">
              Auditable AI search monitoring. See where your brand appears, who
              appears instead, and the answer behind every metric.
            </p>
          </div>
          <FooterLinks title="product" links={productLinks} />
          <FooterLinks title="resources" links={resourceLinks} />
          <FooterLinks title="trust" links={trustLinks} />
          <FooterLinks title="connect" links={connectLinks} />
        </LandingInset>

        <LandingInset className="relative z-1 flex flex-col gap-4 border-border border-t py-5 font-mono text-[10px] text-muted uppercase tracking-[0.08em] sm:flex-row sm:items-center sm:justify-between">
          <span>open-source ai search monitoring · MIT licensed</span>
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={toggleTheme}
              className="flex cursor-pointer items-center gap-2 transition-colors duration-150 hover:text-primary motion-reduce:transition-none"
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            >
              <ThemeToggleIcon theme={theme} size={12} />
              <span>{theme === 'dark' ? 'light theme' : 'dark theme'}</span>
            </button>
          </div>
        </LandingInset>
      </LandingContainer>
    </footer>
  );
};
