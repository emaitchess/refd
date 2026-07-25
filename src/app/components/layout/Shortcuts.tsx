import { useRef } from 'react';
import { useNavigate } from 'react-router';
import { DitherIcon } from '@/components/dither/DitherIcon';
import { useDialogFocus } from '@/hooks/useDialogFocus';
import { useChordKeyPress, useOnKeyPress } from '@/lib/keyboard';
import { NAV } from '@/lib/nav';

export interface ShortcutSpec {
  keys: string[];
  label: string;
  sep: 'then' | '+';
}

export const SHORTCUT_GROUPS: { title: string; items: ShortcutSpec[] }[] = [
  {
    title: 'Navigate',
    items: NAV.map((item) => ({
      keys: ['g', item.chord],
      label: item.label,
      sep: 'then' as const,
    })),
  },
  {
    title: 'Actions',
    items: [
      {
        keys: ['a'],
        label: 'Add prompt (Prompts page)',
        sep: '+',
      },
      {
        keys: ['a'],
        label: 'Add competitor (Competitors page)',
        sep: '+',
      },
    ],
  },
  {
    title: 'Application',
    items: [
      { keys: ['⌘', 'k'], label: 'Command palette', sep: '+' },
      { keys: ['⌘', '/'], label: 'Toggle sidebar', sep: '+' },
      { keys: ['t'], label: 'Toggle theme', sep: '+' },
      { keys: ['⇧', '?'], label: 'Keyboard shortcuts', sep: '+' },
      { keys: ['esc'], label: 'Close an overlay', sep: '+' },
    ],
  },
];

export const useAppShortcuts = ({
  onToggleSidebar,
  onToggleTheme,
  onToggleHelp,
  onTogglePalette,
}: {
  onToggleSidebar: () => void;
  onToggleTheme: () => void;
  onToggleHelp: () => void;
  onTogglePalette: () => void;
}) => {
  const navigate = useNavigate();
  // The palette toggle owns ⌘K even while its search field is focused.
  useOnKeyPress('k', onTogglePalette, {
    meta: true,
    preventDefault: true,
    bypassInputFields: true,
    capture: true,
  });
  useOnKeyPress('/', onToggleSidebar, {
    meta: true,
    preventDefault: true,
    bypassInputFields: true,
    capture: true,
  });
  useOnKeyPress('t', onToggleTheme);
  useOnKeyPress('?', onToggleHelp, { preventDefault: true });
  useChordKeyPress(
    'g',
    Object.fromEntries(
      NAV.map((item) => [item.chord, () => navigate(item.to)]),
    ),
  );
};

const ShortcutKeys = ({ keys, sep }: Pick<ShortcutSpec, 'keys' | 'sep'>) => (
  <span className="flex shrink-0 items-center gap-1">
    {keys.map((key, index) => (
      <span key={`${key}-${index}`} className="flex items-center gap-1">
        {index > 0 ? (
          <span className="font-mono text-[9px] text-muted uppercase tracking-[0.08em]">
            {sep === 'then' ? 'then' : '+'}
          </span>
        ) : null}
        <kbd className="kbd">{key}</kbd>
      </span>
    ))}
  </span>
);

export const ShortcutsDialog = ({ onClose }: { onClose: () => void }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  useDialogFocus(panelRef, titleRef);
  useOnKeyPress('Escape', onClose, { ignoreWhenTyping: false });

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-scrim px-3 pt-8 grayscale-100 backdrop-blur-sm sm:px-6 sm:pt-[10vh]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-title"
    >
      <button
        aria-label="Close keyboard shortcuts"
        className="absolute inset-0 animate-[overlay-fade-in_0.2s_var(--ease-house)] cursor-default motion-reduce:animate-none"
        onClick={onClose}
        type="button"
      />
      <div
        ref={panelRef}
        className="relative flex max-h-[calc(100dvh-4rem)] w-full max-w-[700px] animate-[toast-in_0.25s_var(--ease-house)] flex-col overflow-hidden border border-border-strong bg-bg-elevated shadow-lg motion-reduce:animate-none sm:max-h-[80dvh]"
      >
        <header className="flex min-h-16 items-center gap-3 border-border border-b px-4 sm:px-5">
          <DitherIcon
            name="keyboard"
            size={18}
            className="shrink-0 text-primary"
          />
          <div className="min-w-0 flex-1">
            <h2
              ref={titleRef}
              id="shortcuts-title"
              tabIndex={-1}
              className="font-[550] text-[15px] text-primary tracking-[-0.015em] outline-none"
            >
              Keyboard shortcuts
            </h2>
            <p className="mt-0.5 text-[11px] text-muted">
              Navigate and act without leaving the keyboard.
            </p>
          </div>
          <button
            aria-label="Close keyboard shortcuts"
            className="btn-ghost h-8 px-2"
            onClick={onClose}
            type="button"
          >
            <DitherIcon name="close" size={13} />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 overflow-y-auto sm:grid-cols-2">
          {SHORTCUT_GROUPS.map((group, groupIndex) => (
            <section
              key={group.title}
              className={
                groupIndex === 0
                  ? 'border-border sm:row-span-2 sm:border-r'
                  : groupIndex === 1
                    ? 'border-border border-t sm:border-t-0'
                    : groupIndex === 2
                      ? 'border-border sm:border-t'
                      : undefined
              }
            >
              <h3 className="section-label flex h-9 items-center border-border border-b bg-bg-card px-4 sm:px-5">
                {group.title}
              </h3>
              <ul>
                {group.items.map((item) => (
                  <li
                    key={item.label}
                    className="flex min-h-10 items-center justify-between gap-4 border-border border-b px-4 text-[12px] last:border-b-0 sm:px-5"
                  >
                    <span className="text-secondary">{item.label}</span>
                    <ShortcutKeys keys={item.keys} sep={item.sep} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <footer className="flex min-h-10 items-center justify-end gap-4 border-border border-t bg-bg-card px-4 sm:px-5">
          <span className="hidden items-center gap-1 text-[10px] text-muted sm:flex">
            <kbd className="kbd h-4 min-w-4 text-[9px]">esc</kbd>
            close
          </span>
        </footer>
      </div>
    </div>
  );
};
