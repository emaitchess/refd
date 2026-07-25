import type { DitherIconName } from '@/components/dither/DitherIcon';

export interface NavItem {
  to: string;
  label: string;
  icon: DitherIconName;
  /** Second key of the `g` chord — `g o`, `g p`, … */
  chord: string;
}

// The one nav table: the sidebar rail, the `g`-chord map, the shortcuts dialog,
// and the command palette all read this. Adding a destination here wires all four.
export const NAV: NavItem[] = [
  { to: '/home', label: 'Home', icon: 'home', chord: 'h' },
  { to: '/overview', label: 'Overview', icon: 'overview', chord: 'o' },
  { to: '/prompts', label: 'Prompts', icon: 'prompts', chord: 'p' },
  { to: '/sources', label: 'Sources', icon: 'sources', chord: 's' },
  { to: '/competitors', label: 'Competitors', icon: 'competitors', chord: 'c' },
  { to: '/runs', label: 'Runs', icon: 'runs', chord: 'r' },
  { to: '/help/glossary', label: 'Help', icon: 'question', chord: '/' },
  { to: '/settings', label: 'Settings', icon: 'settings', chord: ',' },
  { to: '/account', label: 'Account', icon: 'account', chord: 'a' },
];
