import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  type ApplicationConfig,
  applicationConfigFor,
  applicationConfigSchema,
  limitReached,
  workspaceLimitMessage,
} from '../../shared/config';
import { resolveWorkspaceDeletion } from '../../shared/workspaces';
import { api, setActiveWorkspaceId } from '../lib/api';
import { useAuth } from './auth';

export interface Workspace {
  id: number;
  name: string;
  hasBrand: boolean;
  // The brand entity's first domain; null until onboarding names one. Drives the
  // workspace favicon.
  brandDomain: string | null;
  onboardingCompleted: boolean;
}

interface WorkspaceState {
  config: ApplicationConfig;
  workspaces: Workspace[];
  current: Workspace | null;
  lastOnboarded: Workspace | null;
  loading: boolean;
  switchTo: (id: number) => void;
  create: (name: string) => Promise<Workspace>;
  rename: (id: number, name: string) => Promise<void>;
  deleteWorkspace: (
    id: number,
    confirmation: string,
  ) => Promise<{ deletedCurrent: boolean; current: Workspace }>;
  markBranded: (id: number) => void;
  markOnboarded: (id: number) => void;
}

const WorkspaceContext = createContext<WorkspaceState | null>(null);

const STORAGE_KEY = 'refd-workspace';
const LAST_ONBOARDED_KEY = 'refd-last-onboarded-workspace';
const FAIL_CLOSED_CONFIG = applicationConfigFor(false);

export const WorkspaceProvider = ({ children }: { children: ReactNode }) => {
  const { markOnboarded: markSessionOnboarded } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [config, setConfig] = useState<ApplicationConfig>(FAIL_CLOSED_CONFIG);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [lastOnboardedId, setLastOnboardedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api<{ workspaces: Workspace[] }>('/workspaces'),
      api<unknown>('/config'),
    ])
      .then(([{ workspaces: list }, rawConfig]) => {
        const parsedConfig = applicationConfigSchema.safeParse(rawConfig);
        if (!parsedConfig.success) {
          throw new Error('invalid application config');
        }
        setConfig(parsedConfig.data);
        setWorkspaces(list);
        const stored = Number.parseInt(
          localStorage.getItem(STORAGE_KEY) ?? '',
          10,
        );
        const initial = list.find((w) => w.id === stored) ?? list[0] ?? null;
        const storedOnboarded = Number.parseInt(
          localStorage.getItem(LAST_ONBOARDED_KEY) ?? '',
          10,
        );
        const lastOnboarded =
          list.find(
            (workspace) =>
              workspace.id === storedOnboarded && workspace.onboardingCompleted,
          ) ??
          (initial?.onboardingCompleted ? initial : null) ??
          list.find((workspace) => workspace.onboardingCompleted) ??
          null;
        setCurrentId(initial?.id ?? null);
        setLastOnboardedId(lastOnboarded?.id ?? null);
        setActiveWorkspaceId(initial?.id ?? null);
        if (lastOnboarded) {
          localStorage.setItem(LAST_ONBOARDED_KEY, String(lastOnboarded.id));
        }
      })
      .catch(() => {
        setConfig(FAIL_CLOSED_CONFIG);
        setWorkspaces([]);
      })
      .finally(() => setLoading(false));
  }, []);

  const switchTo = useCallback(
    (id: number) => {
      if (!workspaces.some((w) => w.id === id)) {
        return;
      }
      localStorage.setItem(STORAGE_KEY, String(id));
      setActiveWorkspaceId(id);
      setCurrentId(id);
      const workspace = workspaces.find((item) => item.id === id);
      if (workspace?.onboardingCompleted) {
        localStorage.setItem(LAST_ONBOARDED_KEY, String(id));
        setLastOnboardedId(id);
      }
    },
    [workspaces],
  );

  const create = useCallback(
    async (name: string) => {
      const limit = config.limits.maxWorkspaces;
      if (limit !== null && limitReached(workspaces.length, limit)) {
        throw new Error(workspaceLimitMessage(limit));
      }
      const created = await api<{ id: number; name: string }>('/workspaces', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      const workspace: Workspace = {
        ...created,
        hasBrand: false,
        brandDomain: null,
        onboardingCompleted: false,
      };
      setWorkspaces((list) => [...list, workspace]);
      localStorage.setItem(STORAGE_KEY, String(workspace.id));
      setActiveWorkspaceId(workspace.id);
      setCurrentId(workspace.id);
      return workspace;
    },
    [config.limits.maxWorkspaces, workspaces.length],
  );

  const rename = useCallback(async (id: number, name: string) => {
    const updated = await api<{ id: number; name: string }>(
      `/workspaces/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      },
    );
    setWorkspaces((list) =>
      list.map((w) => (w.id === id ? { ...w, name: updated.name } : w)),
    );
  }, []);

  const deleteWorkspace = useCallback(
    async (id: number, confirmation: string) => {
      await api(`/workspaces/${id}`, {
        method: 'DELETE',
        body: JSON.stringify({ confirmation }),
      });
      const resolution = resolveWorkspaceDeletion(
        workspaces,
        currentId,
        lastOnboardedId,
        id,
      );
      const nextCurrent = resolution.current;
      if (!nextCurrent) {
        throw new Error('at least one workspace is required');
      }

      setWorkspaces(resolution.remaining);
      setCurrentId(nextCurrent.id);
      setActiveWorkspaceId(nextCurrent.id);
      localStorage.setItem(STORAGE_KEY, String(nextCurrent.id));
      setLastOnboardedId(resolution.lastOnboarded?.id ?? null);
      if (resolution.lastOnboarded) {
        localStorage.setItem(
          LAST_ONBOARDED_KEY,
          String(resolution.lastOnboarded.id),
        );
      } else {
        localStorage.removeItem(LAST_ONBOARDED_KEY);
      }
      return {
        deletedCurrent: resolution.deletedCurrent,
        current: nextCurrent,
      };
    },
    [currentId, lastOnboardedId, workspaces],
  );

  // Step 1 of onboarding creates the brand entity — reflect it without a refetch.
  const markBranded = useCallback((id: number) => {
    setWorkspaces((list) =>
      list.map((w) => (w.id === id ? { ...w, hasBrand: true } : w)),
    );
  }, []);

  // Onboarding commit finished; flip the flag so RequireOnboarded lets it
  // through, and mirror it into the session so public pages relabel their
  // entry points without a refetch.
  const markOnboarded = useCallback(
    (id: number) => {
      setWorkspaces((list) =>
        list.map((w) =>
          w.id === id ? { ...w, hasBrand: true, onboardingCompleted: true } : w,
        ),
      );
      markSessionOnboarded();
      localStorage.setItem(LAST_ONBOARDED_KEY, String(id));
      setLastOnboardedId(id);
    },
    [markSessionOnboarded],
  );

  const value = useMemo(
    () => ({
      config,
      workspaces,
      current: workspaces.find((w) => w.id === currentId) ?? null,
      lastOnboarded: workspaces.find((w) => w.id === lastOnboardedId) ?? null,
      loading,
      switchTo,
      create,
      rename,
      deleteWorkspace,
      markBranded,
      markOnboarded,
    }),
    [
      workspaces,
      config,
      currentId,
      lastOnboardedId,
      loading,
      switchTo,
      create,
      rename,
      deleteWorkspace,
      markBranded,
      markOnboarded,
    ],
  );
  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
};

export const useWorkspace = (): WorkspaceState => {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error('useWorkspace outside WorkspaceProvider');
  }
  return ctx;
};
