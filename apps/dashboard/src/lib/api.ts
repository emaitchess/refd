import { PUBLIC_SITE_ORIGIN } from '@refd/core/public-pages';
import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Absolute API origin in the three-worker split (VITE_API_ORIGIN, baked in at
// build time), or empty for the same-origin bridge where relative URLs resolve
// to the serving origin.
const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN ?? '').replace(/\/$/, '');

// The origin API requests target: the configured split origin, else the current
// page origin. Used to validate cross-origin OAuth return targets.
export const apiOrigin = (): string =>
  API_ORIGIN || (typeof window !== 'undefined' ? window.location.origin : '');

// The public website's origin the dashboard links "back" to. Set per
// environment via VITE_PUBLIC_SITE_ORIGIN (apps/dashboard/.env.*), defaulting to
// production.
export const publicSiteOrigin = (): string =>
  import.meta.env.VITE_PUBLIC_SITE_ORIGIN || PUBLIC_SITE_ORIGIN;

// Workspace-scoped routes live under /w/:id; auth + workspace management
// stay unscoped. The provider sets this before any scoped call renders.
let activeWorkspaceId: number | null = null;
export const setActiveWorkspaceId = (id: number | null) => {
  activeWorkspaceId = id;
};

const UNSCOPED = ['/auth', '/config', '/workspaces', '/health'];

export const apiPath = (path: string): string => {
  const scoped = (() => {
    if (UNSCOPED.some((prefix) => path.startsWith(prefix))) {
      return path;
    }
    if (activeWorkspaceId === null) {
      throw new Error('no active workspace');
    }
    return `/w/${activeWorkspaceId}${path}`;
  })();
  return `${API_ORIGIN}${scoped}`;
};

export const api = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(apiPath(path), {
    // include (not same-origin) so the session cookie rides cross-origin
    // requests to the API Worker; same-origin behavior is unchanged.
    credentials: 'include',
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new ApiError(
      response.status,
      body.error ?? `request failed (${response.status})`,
    );
  }
  return body as T;
};

// Consume a server-sent-event POST: each `data:` frame parses into one event
// for the callback. Non-2xx responses surface as ApiError before any event.
export const apiStream = async (
  path: string,
  init: RequestInit,
  onEvent: (event: Record<string, unknown>) => void,
): Promise<void> => {
  const response = await fetch(apiPath(path), {
    credentials: 'include',
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  if (!response.ok || !response.body) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new ApiError(
      response.status,
      body.error ?? `request failed (${response.status})`,
    );
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffered += decoder.decode(value, { stream: true });
    const frames = buffered.split('\n\n');
    buffered = frames.pop() ?? '';
    for (const frame of frames) {
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) {
          continue;
        }
        try {
          onEvent(JSON.parse(line.slice(5).trim()) as Record<string, unknown>);
        } catch {
          // malformed frame — skip, the stream continues
        }
      }
    }
  }
};

export interface Query<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refetch: () => void;
}

export const useQuery = <T>(path: string | null): Query<T> => {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const generation = useRef(0);

  const load = useCallback(() => {
    if (path === null) {
      return;
    }
    const gen = ++generation.current;
    setLoading(true);
    api<T>(path)
      .then((result) => {
        if (gen === generation.current) {
          setData(result);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (gen === generation.current) {
          setError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (gen === generation.current) {
          setLoading(false);
        }
      });
  }, [path]);

  useEffect(load, [load]);
  return { data, error, loading, refetch: load };
};

// Owns the busy/error lifecycle of a mutating action: run(fn) sets busy, clears
// error, awaits fn, captures any thrown message, and always clears busy.
export const useAsyncAction = () => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
};
