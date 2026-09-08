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

// WebSocket transport for a chat exchange. The POST starts it (creating the
// chat when needed), then the socket watches it: everything that has already
// happened replays first (steps, prose so far, or the terminal done/error),
// then live events arrive until the exchange ends. Same event shapes the old
// SSE frames carried, so rendering is unchanged.
export const apiExchange = async (
  path: string,
  body: unknown,
  onEvent: (event: Record<string, unknown>) => void,
): Promise<void> => {
  const started = await api<{ chatId: number }>(path, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  // Same-site subdomains, so the session cookie rides the upgrade exactly
  // like it rides the credentialed POSTs.
  const target = apiPath(`/chat/${started.chatId}/exchange`);
  const url = target.startsWith('http')
    ? target.replace(/^http/, 'ws')
    : `${window.location.origin.replace(/^http/, 'ws')}${target}`;
  const socket = new WebSocket(url);
  return new Promise<void>((resolve, reject) => {
    // Held in an object because tsc narrows a let to its initial literal
    // when every write happens inside a closure.
    const outcome: { failure: string | null; done: boolean; settled: boolean } =
      { failure: null, done: false, settled: false };
    const settle = (fn: () => void) => {
      if (!outcome.settled) {
        outcome.settled = true;
        fn();
      }
    };
    socket.onmessage = (message) => {
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(String(message.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      onEvent(event);
      if (event.type === 'done') {
        outcome.done = true;
        settle(resolve);
      } else if (event.type === 'error' && typeof event.message === 'string') {
        outcome.failure = event.message;
        settle(() => reject(new ApiError(500, outcome.failure ?? 'failed')));
      }
    };
    socket.onclose = () => {
      settle(() => {
        if (outcome.done) {
          resolve();
        } else {
          reject(
            new ApiError(
              500,
              outcome.failure ?? 'the answer stream ended unexpectedly',
            ),
          );
        }
      });
    };
    socket.onerror = () => {
      // A close event follows; the close handler settles the outcome.
    };
  });
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
