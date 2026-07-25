import { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { DitherIcon } from '@/components/dither/DitherIcon';
import { useOnKeyPress } from '@/lib/keyboard';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/providers/workspace';
import { CommandPalette } from './CommandPalette';
import { ShortcutsDialog, useAppShortcuts } from './Shortcuts';
import { Sidebar } from './Sidebar';

export const Dash = () => {
  const [, toggleTheme] = useTheme();
  const { current: currentWorkspace } = useWorkspace();
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('refd-sidebar-collapsed') === '1',
  );
  const [helpOpen, setHelpOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  const toggleSidebar = useCallback(() => {
    setCollapsed((value) => {
      localStorage.setItem('refd-sidebar-collapsed', value ? '0' : '1');
      return !value;
    });
  }, []);
  const toggleHelp = useCallback(() => setHelpOpen((v) => !v), []);
  const showHelp = useCallback(() => setHelpOpen(true), []);
  const togglePalette = useCallback(() => setPaletteOpen((v) => !v), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  useAppShortcuts({
    onToggleSidebar: toggleSidebar,
    onToggleTheme: toggleTheme,
    onToggleHelp: toggleHelp,
    onTogglePalette: togglePalette,
  });

  useEffect(() => setDrawerOpen(false), [location.pathname]);
  useOnKeyPress('Escape', () => setDrawerOpen(false), {
    enabled: drawerOpen,
    ignoreWhenTyping: false,
  });

  // Lock page scroll while the drawer is open (html + body: iOS ignores
  // body-only overflow locks).
  useEffect(() => {
    if (!drawerOpen) {
      return;
    }
    const prevBody = document.body.style.overflow;
    const prevHtml = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevBody;
      document.documentElement.style.overflow = prevHtml;
    };
  }, [drawerOpen]);

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-3 border-border border-b bg-bg px-4 lg:hidden">
        <button
          type="button"
          aria-label="Open navigation"
          className="btn-ghost h-8 px-1.5"
          onClick={() => setDrawerOpen(true)}
        >
          <DitherIcon name="sidebar" size={16} />
        </button>
        <DitherIcon name="logo" size={18} className="text-primary" />
        <span className="font-mono text-[14px] text-primary">refd</span>
      </header>

      {drawerOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="pane-scrim backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="drawer-panel absolute inset-y-0 left-0 flex w-60 flex-col overflow-hidden border-border-strong border-r bg-bg-elevated">
            <Sidebar
              expanded
              onNavigate={() => setDrawerOpen(false)}
              onShowHelp={showHelp}
            />
          </aside>
        </div>
      ) : null}

      <aside
        className={cn(
          'fixed inset-y-0 z-10 flex flex-col overflow-hidden border-border border-r bg-bg-card transition-[width] duration-200 ease-house max-lg:hidden',
          collapsed ? 'w-14' : 'w-60',
        )}
      >
        <Sidebar
          expanded={!collapsed}
          onToggleSidebar={toggleSidebar}
          onShowHelp={showHelp}
        />
      </aside>

      <main
        className={cn(
          'min-w-0 flex-1 transition-[padding] duration-200 ease-house',
          collapsed ? 'lg:pl-14' : 'lg:pl-60',
        )}
      >
        {/* Remount on workspace switch so every query refetches scoped data. */}
        <div
          key={currentWorkspace?.id}
          className="mx-auto max-w-[1400px] px-4 py-4 sm:px-6 sm:py-6"
        >
          <Outlet />
        </div>
      </main>
      {paletteOpen ? (
        <CommandPalette
          onClose={closePalette}
          onToggleSidebar={toggleSidebar}
          onShowHelp={showHelp}
        />
      ) : null}
      {helpOpen ? <ShortcutsDialog onClose={() => setHelpOpen(false)} /> : null}
    </div>
  );
};
