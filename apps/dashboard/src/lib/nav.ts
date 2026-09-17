import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { DitherIconName } from '@/components/dither/DitherIcon';
import { useWorkspace } from '@/providers/workspace';

export interface NavItem {
  to: string;
  label: string;
  icon: DitherIconName;
  /** Second key of the `g` chord — `g o`, `g p`, … */
  chord: string;
}

const NUMERIC_SEGMENT = /^\d+$/;

// Chat, run, and setup-report ids are scoped to one workspace, so they can
// never survive a switch: an id in the URL is dropped to its parent page and
// a /w/:id prefix is rewritten to the target workspace.
export const switchDestination = (
  pathname: string,
  toWorkspaceId: number,
): string => {
  const segments = pathname.split('/').filter(Boolean);
  let rest = segments;
  let prefixed = false;
  const workspaceId = segments.at(0) === 'w' ? segments.at(1) : undefined;
  if (workspaceId !== undefined && NUMERIC_SEGMENT.test(workspaceId)) {
    prefixed = true;
    rest = rest.slice(2);
  }
  if (rest.at(0) === 'onboarding' && rest.at(1) === 'report') {
    rest = ['onboarding'];
  } else {
    const last = rest.at(-1);
    if (last !== undefined && NUMERIC_SEGMENT.test(last)) {
      rest = rest.slice(0, -1);
    }
  }
  const destination = `${prefixed ? `/w/${toWorkspaceId}` : ''}${
    rest.length > 0 ? `/${rest.join('/')}` : ''
  }`;
  return destination === '' ? '/' : destination;
};

// The one user-facing switch path: lands on the destination first, then flips
// the workspace context, so the URL never names another workspace's resource.
export const useSwitchWorkspace = () => {
  const { switchTo, workspaces } = useWorkspace();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return useCallback(
    (id: number) => {
      const target = workspaces.find((w) => w.id === id);
      navigate(
        target && !target.onboardingCompleted
          ? '/onboarding'
          : switchDestination(pathname, id),
        { replace: true },
      );
      switchTo(id);
    },
    [navigate, pathname, switchTo, workspaces],
  );
};

// The one nav table: the sidebar rail, the `g`-chord map, the shortcuts dialog,
// and the command palette all read this. Adding a destination here wires all four.
export const NAV: NavItem[] = [
  { to: '/home', label: 'Home', icon: 'home', chord: 'h' },
  { to: '/overview', label: 'Overview', icon: 'overview', chord: 'o' },
  { to: '/prompts', label: 'Prompts', icon: 'prompts', chord: 'p' },
  { to: '/sources', label: 'Sources', icon: 'sources', chord: 's' },
  { to: '/competitors', label: 'Competitors', icon: 'competitors', chord: 'c' },
  { to: '/runs', label: 'Runs', icon: 'runs', chord: 'r' },
  { to: '/help', label: 'Help', icon: 'question', chord: '/' },
  { to: '/settings', label: 'Settings', icon: 'settings', chord: ',' },
  { to: '/account', label: 'Account', icon: 'account', chord: 'a' },
];
