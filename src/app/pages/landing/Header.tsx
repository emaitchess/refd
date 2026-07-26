import { useLenis } from 'lenis/react';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { DitherIcon } from '@/components/dither/DitherIcon';
import { CREATE_ACCOUNT_URL, SIGN_IN_URL } from '@/lib/routes';
import { useTheme } from '@/lib/theme';
import {
  LandingContainer,
  LandingInset,
  ThemeToggleIcon,
  useAccountCta,
} from './chrome';

const NAV_SECTIONS = [
  { id: 'platform', label: 'platform' },
  { id: 'signals', label: 'signals' },
  { id: 'open-source', label: 'open source' },
];

export const Header = () => {
  const { authed, to, label } = useAccountCta();
  const lenis = useLenis();
  const [theme, toggleTheme] = useTheme();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [headerScrolled, setHeaderScrolled] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuToggleRef = useRef<HTMLButtonElement>(null);

  // Scrollspy: the nav link whose section holds the viewport midline lights
  // up; in sections without a nav entry (hero, premise, ...) none is active.
  // The rootMargin band is thinner than any section, so at most one matches.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const entering = entries.find((entry) => entry.isIntersecting);
        setActiveSection((current) => {
          if (entering) {
            return entering.target.id;
          }
          const leftActive = entries.some(
            (entry) => entry.target.id === current,
          );
          return leftActive ? null : current;
        });
      },
      { rootMargin: '-45% 0px -54% 0px' },
    );
    for (const { id } of NAV_SECTIONS) {
      const el = document.getElementById(id);
      if (el) {
        observer.observe(el);
      }
    }
    return () => observer.disconnect();
  }, []);

  // Lenis intercepts wheel events at the window, so body overflow alone
  // can't lock the page behind the open menu; stopping Lenis can.
  useEffect(() => {
    if (!mobileMenuOpen || !lenis) {
      return;
    }
    lenis.stop();
    return () => lenis.start();
  }, [mobileMenuOpen, lenis]);

  // While the menu is open, Tab cycles through the toggle plus the menu items
  // (the page behind the overlay stays in the tab order otherwise); Escape
  // closes, and closing hands focus back to the toggle.
  useEffect(() => {
    if (!mobileMenuOpen) {
      return;
    }
    const overflow = document.body.style.overflow;
    const focusables = () => {
      const inMenu = menuRef.current
        ? Array.from(
            menuRef.current.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled])',
            ),
          )
        : [];
      const toggle = menuToggleRef.current;
      return toggle ? [toggle, ...inMenu] : inMenu;
    };
    focusables()[1]?.focus();
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileMenuOpen(false);
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }
      const items = focusables();
      if (items.length === 0) {
        return;
      }
      event.preventDefault();
      const index = items.indexOf(document.activeElement as HTMLElement);
      const next = event.shiftKey
        ? items[(index <= 0 ? items.length : index) - 1]
        : items[(index + 1) % items.length];
      next?.focus();
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeydown);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener('keydown', onKeydown);
      menuToggleRef.current?.focus();
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 768px)');
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) {
        setMobileMenuOpen(false);
      }
    };
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, []);

  useEffect(() => {
    const update = () => {
      setHeaderScrolled(window.scrollY > 1);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);

  return (
    <>
      <header
        className={`fixed inset-x-0 top-0 z-60 border-border border-b transition-[border-color,background-color,backdrop-filter] duration-200 ${
          headerScrolled
            ? 'bg-bg/90 backdrop-blur-xl'
            : 'bg-transparent backdrop-blur-none'
        }`}
        style={{
          borderBottomColor: headerScrolled
            ? 'var(--color-border)'
            : 'transparent',
        }}
      >
        <LandingContainer>
          <LandingInset className="relative flex h-14 items-center justify-start md:grid md:h-17 md:grid-cols-[1fr_auto_1fr]">
            <nav className="hidden items-center gap-6 md:flex">
              {NAV_SECTIONS.map(({ id, label }) => (
                <a
                  key={id}
                  href={`#${id}`}
                  aria-current={activeSection === id ? 'true' : undefined}
                  className={`text-[13px] transition-colors duration-200 ${
                    activeSection === id
                      ? 'text-primary'
                      : 'text-secondary hover:text-primary'
                  }`}
                >
                  {label}
                </a>
              ))}
            </nav>
            <button
              type="button"
              className="flex items-center gap-2.5"
              aria-label="refd home"
              onClick={() => {
                setMobileMenuOpen(false);
                if (lenis) {
                  lenis.scrollTo(0, { force: true });
                } else {
                  document.getElementById('top')?.scrollIntoView();
                }
              }}
            >
              <DitherIcon name="logo" size={20} className="text-primary" />
              <span className="font-mono text-[15px] text-primary">refd</span>
            </button>
            <nav className="hidden items-center justify-end gap-2 md:flex">
              {authed ? (
                <a href={to} className="btn-primary">
                  {label}
                </a>
              ) : (
                <>
                  <a href={SIGN_IN_URL} className="btn-ghost px-3">
                    sign in
                  </a>
                  <a href={CREATE_ACCOUNT_URL} className="btn-primary">
                    start monitoring
                  </a>
                </>
              )}
            </nav>
            <button
              type="button"
              className="absolute right-5 flex size-8 items-center justify-center text-primary sm:right-8 md:hidden"
              aria-label={
                mobileMenuOpen
                  ? 'Close navigation menu'
                  : 'Open navigation menu'
              }
              aria-controls="landing-mobile-menu"
              aria-expanded={mobileMenuOpen}
              ref={menuToggleRef}
              onClick={() => setMobileMenuOpen((open) => !open)}
            >
              <DitherIcon name={mobileMenuOpen ? 'close' : 'menu'} size={16} />
            </button>
          </LandingInset>
        </LandingContainer>
      </header>
      <div
        id="landing-mobile-menu"
        ref={menuRef}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        aria-hidden={!mobileMenuOpen}
        inert={!mobileMenuOpen}
        data-lenis-prevent
        data-stagger-in={mobileMenuOpen}
        className={`fixed inset-x-0 top-14 bottom-0 z-50 overflow-y-auto overscroll-contain bg-bg transition-opacity duration-240 ease-out will-change-[opacity] motion-reduce:transition-none md:hidden ${
          mobileMenuOpen
            ? 'pointer-events-auto opacity-100'
            : 'pointer-events-none opacity-0'
        }`}
      >
        <LandingContainer
          className={`min-h-full transform-gpu bg-bg transition-transform duration-320 ease-house will-change-transform motion-reduce:transition-none ${
            mobileMenuOpen ? 'translate-y-0' : '-translate-y-2'
          }`}
        >
          <nav
            aria-label="Mobile navigation"
            className="flex min-h-[calc(100svh-56px)] flex-col"
          >
            {NAV_SECTIONS.map(({ id, label }, i) => (
              <a
                key={id}
                href={`#${id}`}
                onClick={() => setMobileMenuOpen(false)}
                className="landing-stagger-item flex h-11 items-center justify-between border-border border-b px-5 text-[13px] text-primary sm:px-8"
                style={{ '--stagger': i } as CSSProperties}
              >
                {label}
                <span className="font-mono text-[10px] text-muted">
                  {String(i + 1).padStart(2, '0')}
                </span>
              </a>
            ))}
            <button
              type="button"
              onClick={toggleTheme}
              className="landing-stagger-item mt-auto flex h-11 w-full cursor-pointer items-center border-border border-y px-5 text-[13px] text-secondary sm:px-8"
              style={{ '--stagger': 3 } as CSSProperties}
            >
              <span className="flex items-center gap-2.5">
                <ThemeToggleIcon theme={theme} size={13} />
                {theme === 'dark' ? 'light mode' : 'dark mode'}
              </span>
            </button>
            {authed ? (
              <div
                className="landing-stagger-item px-5 pt-4 pb-5 sm:px-8"
                style={{ '--stagger': 4 } as CSSProperties}
              >
                <a
                  href={to}
                  onClick={() => setMobileMenuOpen(false)}
                  className="btn-primary h-10 w-full"
                >
                  {label}
                </a>
              </div>
            ) : (
              <div
                className="landing-stagger-item grid grid-cols-2 gap-2 px-5 pt-4 pb-5 sm:px-8"
                style={{ '--stagger': 4 } as CSSProperties}
              >
                <a
                  href={SIGN_IN_URL}
                  onClick={() => setMobileMenuOpen(false)}
                  className="btn-secondary h-10"
                >
                  sign in
                </a>
                <a
                  href={CREATE_ACCOUNT_URL}
                  onClick={() => setMobileMenuOpen(false)}
                  className="btn-primary h-10"
                >
                  start monitoring
                </a>
              </div>
            )}
          </nav>
        </LandingContainer>
      </div>
    </>
  );
};
