import type { IFuseOptions } from 'fuse.js';
import {
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router';
import {
  DitherIcon,
  type DitherIconName,
} from '@/components/dither/DitherIcon';
import { useDialogFocus } from '@/hooks/useDialogFocus';
import {
  type UseFuzzySearchOptions,
  useFuzzySearch,
} from '@/hooks/useFuzzySearch';
import { useOnKeyPress } from '@/lib/keyboard';
import { NAV } from '@/lib/nav';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth';
import { useWorkspace } from '@/providers/workspace';
import { limitReached } from '../../../shared/config';

interface Command {
  id: string;
  group: 'Navigate' | 'Actions' | 'Workspace' | 'Application';
  label: string;
  description?: string;
  keywords: string[];
  icon: DitherIconName;
  keys?: string;
  run: () => void;
}

const GROUP_ORDER: Command['group'][] = [
  'Navigate',
  'Actions',
  'Workspace',
  'Application',
];

const COMMAND_FUSE_OPTIONS: IFuseOptions<Command> = {
  keys: [
    { name: 'label', weight: 0.7 },
    { name: 'keywords', weight: 0.2 },
    { name: 'group', weight: 0.1 },
  ],
  threshold: 0.38,
  ignoreDiacritics: true,
  ignoreLocation: true,
  includeScore: true,
  useTokenSearch: true,
};

const COMMAND_SEARCH_OPTIONS: UseFuzzySearchOptions<Command> = {
  fuseOptions: COMMAND_FUSE_OPTIONS,
  defer: false,
};

const CommandKeys = ({ keys }: { keys: string }) => (
  <span className="ml-auto hidden shrink-0 items-center gap-1 sm:flex">
    {keys.split(' ').map((key, index) => (
      <kbd key={`${key}-${index}`} className="kbd h-4 min-w-4 text-[9px]">
        {key}
      </kbd>
    ))}
  </span>
);

export const CommandPalette = ({
  onClose,
  onToggleSidebar,
  onShowHelp,
}: {
  onClose: () => void;
  onToggleSidebar: () => void;
  onShowHelp: () => void;
}) => {
  const navigate = useNavigate();
  const { config, workspaces, current, switchTo } = useWorkspace();
  const { logout } = useAuth();
  const [theme, toggleTheme] = useTheme();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useDialogFocus(panelRef, inputRef);

  useOnKeyPress(
    'Escape',
    () => {
      if (query) {
        setQuery('');
        return;
      }
      onClose();
    },
    { ignoreWhenTyping: false },
  );

  const commands = useMemo<Command[]>(() => {
    const act = (action: () => void) => () => {
      onClose();
      action();
    };
    return [
      ...NAV.map((item) => ({
        id: `nav:${item.to}`,
        group: 'Navigate' as const,
        label: item.label,
        description: `Open ${item.label.toLowerCase()}`,
        keywords: [item.to, 'page', 'go', 'navigation'],
        icon: item.icon,
        keys: `g ${item.chord}`,
        run: act(() => navigate(item.to)),
      })),
      {
        id: 'add-prompt',
        group: 'Actions',
        label: 'Add prompt',
        description: 'Create a question to monitor',
        keywords: ['new', 'create', 'question'],
        icon: 'prompts',
        run: act(() => navigate('/prompts?new=1')),
      },
      {
        id: 'add-competitor',
        group: 'Actions',
        label: 'Add competitor',
        description: 'Track another brand',
        keywords: ['new', 'create', 'brand', 'entity'],
        icon: 'competitors',
        run: act(() => navigate('/competitors?new=1')),
      },
      ...(limitReached(workspaces.length, config.limits.maxWorkspaces)
        ? []
        : [
            {
              id: 'new-workspace',
              group: 'Workspace' as const,
              label: 'New workspace',
              description: 'Set up another monitored brand',
              keywords: ['add', 'create', 'brand', 'settings'],
              icon: 'settings' as const,
              run: act(() => navigate('/settings?new-workspace=1')),
            },
          ]),
      ...workspaces
        .filter((workspace) => workspace.id !== current?.id)
        .map((workspace) => ({
          id: `ws:${workspace.id}`,
          group: 'Workspace' as const,
          label: `Switch to ${workspace.name}`,
          description: workspace.brandDomain ?? 'Workspace without a brand',
          keywords: [
            'change',
            'brand',
            'workspace',
            workspace.brandDomain ?? '',
          ],
          icon: 'arrow-right' as DitherIconName,
          run: act(() => switchTo(workspace.id)),
        })),
      {
        id: 'theme',
        group: 'Application',
        label: theme === 'dark' ? 'Use light theme' : 'Use dark theme',
        description: 'Change the interface appearance',
        keywords: ['toggle', 'appearance', 'color', 'mode'],
        icon: theme === 'dark' ? 'sun' : 'moon',
        keys: 't',
        run: act(toggleTheme),
      },
      {
        id: 'sidebar',
        group: 'Application',
        label: 'Toggle sidebar',
        description: 'Collapse or expand navigation',
        keywords: ['navigation', 'rail', 'menu'],
        icon: 'sidebar',
        keys: '⌘ /',
        run: act(onToggleSidebar),
      },
      {
        id: 'help',
        group: 'Application',
        label: 'Keyboard shortcuts',
        description: 'View every available shortcut',
        keywords: ['help', 'keys', 'commands'],
        icon: 'keyboard',
        keys: '⇧ ?',
        run: act(onShowHelp),
      },
      {
        id: 'logout',
        group: 'Application',
        label: 'Log out',
        description: 'End this browser session',
        keywords: ['sign out', 'exit', 'account'],
        icon: 'power',
        run: act(() => void logout()),
      },
    ];
  }, [
    navigate,
    config.limits.maxWorkspaces,
    workspaces,
    current,
    switchTo,
    logout,
    theme,
    toggleTheme,
    onClose,
    onToggleSidebar,
    onShowHelp,
  ]);

  const search = useFuzzySearch(commands, query, COMMAND_SEARCH_OPTIONS);
  const groups = useMemo(
    () =>
      GROUP_ORDER.map((title) => ({
        title,
        items: search.items.filter((command) => command.group === title),
      })).filter((group) => group.items.length),
    [search.items],
  );
  const visible = useMemo(
    () => groups.flatMap((group) => group.items),
    [groups],
  );

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    if (active >= visible.length) {
      setActive(Math.max(0, visible.length - 1));
    }
  }, [active, visible.length]);
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const runActive = () => visible[active]?.run();
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!visible.length) {
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => (index + 1) % visible.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => (index - 1 + visible.length) % visible.length);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActive(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActive(visible.length - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      runActive();
    }
  };

  const activeId = visible[active]?.id;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-scrim px-3 pt-8 grayscale-100 backdrop-blur-sm sm:px-6 sm:pt-[10vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <button
        aria-label="Close command palette"
        className="absolute inset-0 animate-[overlay-fade-in_0.2s_var(--ease-house)] cursor-default motion-reduce:animate-none"
        onClick={onClose}
        type="button"
      />
      <div
        ref={panelRef}
        className="relative flex max-h-[calc(100dvh-4rem)] w-full max-w-[600px] animate-[toast-in_0.25s_var(--ease-house)] flex-col overflow-hidden border border-border-strong bg-bg-elevated shadow-lg motion-reduce:animate-none sm:max-h-[78dvh]"
      >
        <div className="flex min-h-13 items-center border-border border-b px-4">
          <DitherIcon
            name="search"
            size={16}
            className="mr-3 shrink-0 text-muted"
          />
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            aria-controls="command-results"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-activedescendant={
              activeId ? `command-${activeId.replaceAll(':', '-')}` : undefined
            }
            className="h-12 min-w-0 flex-1 appearance-none bg-transparent text-[14px] text-primary placeholder:text-muted [&::-webkit-search-cancel-button]:appearance-none"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search pages, actions, or workspaces"
            value={query}
          />
          {query ? (
            <button
              type="button"
              className="btn-ghost h-8 px-2"
              aria-label="Clear command search"
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
            >
              <DitherIcon name="close" size={12} />
            </button>
          ) : (
            <kbd className="kbd hidden sm:inline-flex">⌘ K</kbd>
          )}
        </div>

        <div
          id="command-results"
          ref={listRef}
          role="listbox"
          aria-label="Commands"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1.5"
        >
          {groups.map((group, groupIndex) => (
            <section
              key={group.title}
              aria-labelledby={`group-${group.title}`}
              className={cn(groupIndex > 0 && 'border-border border-t')}
            >
              <h2
                id={`group-${group.title}`}
                className="section-label flex h-8 items-center px-4"
              >
                {group.title}
              </h2>
              {group.items.map((command) => {
                const index = visible.indexOf(command);
                const isActive = index === active;
                return (
                  <button
                    key={command.id}
                    id={`command-${command.id.replaceAll(':', '-')}`}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    data-active={isActive}
                    onClick={command.run}
                    onMouseEnter={() => setActive(index)}
                    className={cn(
                      'flex min-h-11 w-full cursor-pointer items-center gap-3 border-transparent border-l px-4 text-left transition-colors duration-100',
                      isActive
                        ? 'border-primary bg-accent-soft text-primary'
                        : 'text-secondary hover:bg-bg-card-hover',
                    )}
                  >
                    <DitherIcon
                      name={command.icon}
                      size={15}
                      className="size-[15px] shrink-0 opacity-80"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px]">
                        {command.label}
                      </span>
                      {command.description ? (
                        <span className="mt-0.5 block truncate text-[10px] text-muted">
                          {command.description}
                        </span>
                      ) : null}
                    </span>
                    {command.keys ? <CommandKeys keys={command.keys} /> : null}
                  </button>
                );
              })}
            </section>
          ))}
          {visible.length ? null : (
            <div className="flex min-h-40 flex-col items-center justify-center px-4 text-center">
              <DitherIcon name="search" size={20} className="text-muted" />
              <p className="mt-3 text-[13px] text-primary">No commands found</p>
              <p className="mt-1 text-[11px] text-muted">
                Try a page, action, workspace, or setting.
              </p>
            </div>
          )}
        </div>

        <footer className="hidden min-h-10 items-center justify-between gap-4 border-border border-t bg-bg-card px-4 sm:flex">
          <span className="font-mono text-[10px] text-muted uppercase tracking-[0.08em]">
            {visible.length} {visible.length === 1 ? 'command' : 'commands'}
          </span>
          <span className="flex items-center gap-3 text-[10px] text-muted">
            <span className="flex items-center gap-1">
              <kbd className="kbd h-4 min-w-4 text-[9px]">↑</kbd>
              <kbd className="kbd h-4 min-w-4 text-[9px]">↓</kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="kbd h-4 min-w-4 text-[9px]">↵</kbd>
              open
            </span>
            <span className="flex items-center gap-1">
              <kbd className="kbd h-4 min-w-4 text-[9px]">esc</kbd>
              {query ? 'clear' : 'close'}
            </span>
          </span>
        </footer>
      </div>
    </div>
  );
};
