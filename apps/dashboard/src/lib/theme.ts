import { useCallback, useEffect, useSyncExternalStore } from 'react';

type Theme = 'dark' | 'light';

const STORAGE_KEY = 'refd-theme';

const systemTheme = (): Theme =>
  window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';

// Stored choice wins; with none, follow the OS. Mirrors the pre-paint script in index.html.
const readInitial = (): Theme => {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : systemTheme();
};

// The theme is one value for the whole app, so it lives outside React rather than
// in each caller's useState. Per-caller state desyncs the moment two components
// use it: whoever toggles repaints the document (a global) while the others keep
// rendering their own stale copy — `t` in Dash recoloured the page but left the
// sidebar's label naming the old theme. An external store can't drift.
let current: Theme | null = null;
const listeners = new Set<() => void>();

const apply = (theme: Theme) => {
  document.documentElement.dataset.theme = theme;
  // Favicon tracks the in-app theme; a <link media> query would only see the OS.
  document
    .getElementById('app-favicon')
    ?.setAttribute(
      'href',
      theme === 'light' ? '/logo-light.svg' : '/logo-dark.svg',
    );
};

// Lazy: reading localStorage at module scope would break a non-browser import.
const getSnapshot = (): Theme => {
  if (current === null) {
    current = readInitial();
  }
  return current;
};

const getServerSnapshot = (): Theme => 'dark';

const setTheme = (next: Theme) => {
  if (next === getSnapshot()) {
    return;
  }
  current = next;
  apply(next);
  for (const listener of listeners) {
    listener();
  }
};

// Track the OS theme until the user makes an explicit choice (then it sticks).
// Bound once on first subscribe rather than per hook call.
let mediaBound = false;
const bindMedia = () => {
  if (mediaBound) {
    return;
  }
  mediaBound = true;
  window
    .matchMedia('(prefers-color-scheme: light)')
    .addEventListener('change', (event) => {
      if (!localStorage.getItem(STORAGE_KEY)) {
        setTheme(event.matches ? 'light' : 'dark');
      }
    });
};

const subscribe = (listener: () => void) => {
  bindMedia();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useTheme = (): [Theme, () => void] => {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Idempotent; keeps the document honest if the pre-paint script never ran.
  useEffect(() => {
    apply(theme);
  }, [theme]);

  const toggle = useCallback(() => {
    const next: Theme = getSnapshot() === 'dark' ? 'light' : 'dark';
    localStorage.setItem(STORAGE_KEY, next);
    setTheme(next);
  }, []);

  return [theme, toggle];
};
