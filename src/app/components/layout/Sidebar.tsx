import { Link, NavLink } from 'react-router';
import { DitherIcon } from '@/components/dither/DitherIcon';
import { Tooltip } from '@/components/dither-kit/tooltip';
import { NAV, type NavItem } from '@/lib/nav';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth';
import { Fade } from './Fade';
import { KeyHint, ShortcutKeys } from './KeyHint';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

const ROW =
  'relative flex h-9 w-full items-center gap-2.5 whitespace-nowrap pr-3 pl-[21px] focus-visible:z-10';
const ICON = 'size-[14px] shrink-0';
const ACTION_ROW =
  'group cursor-pointer text-secondary text-[13px] transition-colors duration-150 hover:bg-bg-card-hover hover:text-primary';
const TOOLTIP_PROPS = {
  placement: 'right' as const,
  offset: 8,
  className: 'border-border-strong bg-bg-elevated text-primary shadow-lg',
};

const tooltipContent = (label: string, shortcut?: string) => (
  <span className="flex items-center gap-2">
    <span>{label}</span>
    {shortcut ? (
      <span className="flex items-center gap-0.5">
        <ShortcutKeys keys={shortcut} />
      </span>
    ) : null}
  </span>
);

const UTILITY_PATHS = new Set(['/help', '/settings', '/account']);
const PRIMARY_NAV = NAV.filter((item) => !UTILITY_PATHS.has(item.to));
const UTILITY_NAV = NAV.filter((item) => UTILITY_PATHS.has(item.to));

const SidebarLink = ({
  item,
  expanded,
  onNavigate,
}: {
  item: NavItem;
  expanded: boolean;
  onNavigate?: () => void;
}) => (
  <Tooltip
    {...TOOLTIP_PROPS}
    asChild
    content={tooltipContent(item.label, `g ${item.chord}`)}
    disabled={expanded}
  >
    <NavLink
      to={item.to}
      end={item.to === '/'}
      aria-label={expanded ? undefined : item.label}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          ROW,
          'group font-[450] text-[13px] transition-[background-color,color,box-shadow] duration-150',
          isActive
            ? 'bg-accent-soft text-primary shadow-[inset_1px_0_0_var(--color-primary)]'
            : 'text-secondary hover:bg-bg-card-hover hover:text-primary',
        )
      }
    >
      <DitherIcon
        name={item.icon}
        size={14}
        className={cn(ICON, 'opacity-80')}
      />
      <Fade show={expanded}>{item.label}</Fade>
      <KeyHint keys={`g ${item.chord}`} show={expanded} />
    </NavLink>
  </Tooltip>
);

export const Sidebar = ({
  expanded,
  onNavigate,
  onToggleSidebar,
  onShowHelp,
}: {
  expanded: boolean;
  onNavigate?: () => void;
  onToggleSidebar?: () => void;
  onShowHelp: () => void;
}) => {
  const { logout } = useAuth();
  const [theme, toggleTheme] = useTheme();

  return (
    <>
      <Tooltip
        {...TOOLTIP_PROPS}
        asChild
        content={tooltipContent('refd home', 'g h')}
        disabled={expanded}
      >
        <Link
          to="/home"
          onClick={onNavigate}
          aria-label="refd home"
          className="flex h-9 shrink-0 items-center gap-2.5 pr-3 pl-[18px] text-primary transition-colors duration-150 hover:bg-bg-card-hover focus-visible:z-10"
        >
          <DitherIcon name="logo" size={20} className="shrink-0" />
          <Fade show={expanded}>
            <span className="font-mono text-[14px]">refd</span>
          </Fade>
        </Link>
      </Tooltip>

      <WorkspaceSwitcher expanded={expanded} />

      <nav aria-label="Workspace navigation" className="flex flex-1 flex-col">
        {PRIMARY_NAV.map((item) => (
          <SidebarLink
            key={item.to}
            item={item}
            expanded={expanded}
            onNavigate={onNavigate}
          />
        ))}
      </nav>

      <div className="flex shrink-0 flex-col border-border border-t">
        {UTILITY_NAV.map((item) => (
          <SidebarLink
            key={item.to}
            item={item}
            expanded={expanded}
            onNavigate={onNavigate}
          />
        ))}
        <Tooltip
          {...TOOLTIP_PROPS}
          asChild
          content={tooltipContent(
            theme === 'dark' ? 'Light mode' : 'Dark mode',
            't',
          )}
          disabled={expanded}
        >
          <button
            type="button"
            className={cn(ROW, ACTION_ROW)}
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            <DitherIcon
              name={theme === 'dark' ? 'sun' : 'moon'}
              size={14}
              className={ICON}
            />
            <Fade show={expanded}>
              <span>{theme === 'dark' ? 'light mode' : 'dark mode'}</span>
            </Fade>
            <KeyHint keys="t" show={expanded} />
          </button>
        </Tooltip>
        <Tooltip
          {...TOOLTIP_PROPS}
          asChild
          content={tooltipContent('Keyboard shortcuts', '⇧ ?')}
          disabled={expanded}
        >
          <button
            type="button"
            className={cn(ROW, ACTION_ROW)}
            onClick={onShowHelp}
            aria-label="Keyboard shortcuts"
          >
            <DitherIcon name="keyboard" size={14} className={ICON} />
            <Fade show={expanded}>
              <span>shortcuts</span>
            </Fade>
            <KeyHint keys="⇧ ?" show={expanded} />
          </button>
        </Tooltip>
        <Tooltip
          {...TOOLTIP_PROPS}
          asChild
          content="Log out"
          disabled={expanded}
        >
          <button
            type="button"
            className={cn(ROW, ACTION_ROW)}
            onClick={logout}
            aria-label="Log out"
          >
            <DitherIcon name="power" size={14} className={ICON} />
            <Fade show={expanded}>
              <span>log out</span>
            </Fade>
          </button>
        </Tooltip>
      </div>
      {onToggleSidebar && (
        <div className="border-border border-t">
          <Tooltip
            {...TOOLTIP_PROPS}
            asChild
            content={tooltipContent('Expand sidebar', '⌘ /')}
            disabled={expanded}
          >
            <button
              type="button"
              onClick={onToggleSidebar}
              aria-label={`${expanded ? 'Collapse' : 'Expand'} sidebar`}
              className={cn(ROW, ACTION_ROW)}
            >
              <DitherIcon name="sidebar" size={14} className={ICON} />
              <Fade show={expanded}>
                <span>{expanded ? 'collapse' : 'expand'}</span>
              </Fade>
              <KeyHint keys="⌘ /" show={expanded} />
            </button>
          </Tooltip>
        </div>
      )}
    </>
  );
};
