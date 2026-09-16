import {
  type ChatStartResponse,
  type ChatStreamEvent,
  chatStartResponseSchema,
  chatStreamEventSchema,
  isActiveChatExchange,
} from '@refd/core/chat';
import { PUBLIC_SITE_ORIGIN } from '@refd/core/public-pages';
import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiError extends Error {
  status: number;
  // The raw error body, for structured responses like draft-version conflicts.
  body?: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
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
  const body = (await response.json().catch(() => ({}))) as {
    error?: unknown;
  };
  if (!response.ok) {
    throw new ApiError(
      response.status,
      typeof body.error === 'string'
        ? body.error
        : body.error &&
            typeof body.error === 'object' &&
            'message' in body.error &&
            typeof (body.error as { message: unknown }).message === 'string'
          ? (body.error as { message: string }).message
          : `request failed (${response.status})`,
      body,
    );
  }
  return body as T;
};

// WebSocket transport for a chat exchange. The POST starts it (creating the
// chat when needed), then the socket watches it: everything that has already
// happened replays first (steps, prose so far, or the terminal done/error),
// then live events arrive until the exchange ends. Same event shapes the old
// SSE frames carried, so rendering is unchanged.
export interface ExchangeOutcome {
  chatId: number;
  exchangeId: string;
  // The terminal done frame, when the socket carried one.
  done: Record<string, unknown> | null;
  // Terminal exchange error the server reported, when it did.
  failure: string | null;
  // True when the watcher detached without a terminal frame: user abort, a
  // socket that closed early, or one that never opened (the CSP failure
  // mode). The exchange keeps running server-side and its pair lands in D1,
  // so the caller polls instead of treating this as an error.
  detached: boolean;
  // The persisted question's row id, for the post-detach poll.
  questionId: number | null;
  lastEventSeq: number;
}

const startChatExchange = async (
  path: string,
  body: unknown,
  requestId: string,
): Promise<ChatStartResponse> => {
  const start = () =>
    api<unknown>(path, {
      method: 'POST',
      body: JSON.stringify({
        ...(body && typeof body === 'object' ? body : {}),
        requestId,
      }),
    });
  let raw: unknown;
  try {
    raw = await start();
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    raw = await start();
  }
  const parsed = chatStartResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(500, 'the server returned an invalid exchange receipt');
  }
  return parsed.data;
};

const websocketUrl = (path: string): string => {
  const target = apiPath(path);
  return target.startsWith('http')
    ? target.replace(/^http/, 'ws')
    : `${window.location.origin.replace(/^http/, 'ws')}${target}`;
};

export const watchChatExchange = async (
  started: ChatStartResponse,
  onEvent: (event: ChatStreamEvent) => void,
  opts?: { signal?: AbortSignal; after?: number },
): Promise<ExchangeOutcome> => {
  const blank: ExchangeOutcome = {
    chatId: started.chatId,
    exchangeId: started.exchange.id,
    done: null,
    failure: null,
    detached: false,
    questionId: started.exchange.questionId,
    lastEventSeq: opts?.after ?? 0,
  };
  let lastEventSeq = blank.lastEventSeq;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (opts?.signal?.aborted) {
      return { ...blank, detached: true, lastEventSeq };
    }
    const url = new URL(
      websocketUrl(`/chat/${started.chatId}/exchanges/${started.exchange.id}`),
    );
    url.searchParams.set('after', String(lastEventSeq));
    const outcome = await new Promise<ExchangeOutcome>((resolve) => {
      const socket = new WebSocket(url);
      const settled = { value: false };
      const connectionTimer = window.setTimeout(() => socket.close(), 10_000);
      const settle = (value: ExchangeOutcome) => {
        if (!settled.value) {
          settled.value = true;
          window.clearTimeout(connectionTimer);
          resolve(value);
        }
      };
      const abort = () => {
        socket.onclose = null;
        socket.close();
        settle({ ...blank, detached: true, lastEventSeq });
      };
      opts?.signal?.addEventListener('abort', abort, { once: true });
      socket.onopen = () => window.clearTimeout(connectionTimer);
      socket.onmessage = (message) => {
        let raw: unknown;
        try {
          raw = JSON.parse(String(message.data));
        } catch {
          return;
        }
        const parsed = chatStreamEventSchema.safeParse(raw);
        if (
          !parsed.success ||
          parsed.data.exchangeId !== started.exchange.id ||
          parsed.data.seq <= lastEventSeq
        ) {
          return;
        }
        const event = parsed.data;
        lastEventSeq = event.seq;
        onEvent(event);
        if (event.type === 'done') {
          settle({ ...blank, done: event, lastEventSeq });
        } else if (event.type === 'error') {
          settle({ ...blank, failure: event.message, lastEventSeq });
        }
      };
      socket.onclose = () => {
        opts?.signal?.removeEventListener('abort', abort);
        settle({ ...blank, detached: true, lastEventSeq });
      };
      socket.onerror = () => {};
    });
    if (!outcome.detached || opts?.signal?.aborted) {
      return outcome;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 250));
  }
  return { ...blank, detached: true, lastEventSeq };
};

export const apiExchange = async (
  path: string,
  body: unknown,
  onEvent: (event: Record<string, unknown>) => void,
  opts?: {
    signal?: AbortSignal;
    onAccepted?: (started: ChatStartResponse) => void;
  },
): Promise<ExchangeOutcome> => {
  const started = await startChatExchange(path, body, crypto.randomUUID());
  opts?.onAccepted?.(started);
  if (!isActiveChatExchange(started.exchange.status)) {
    const failed =
      started.exchange.status === 'failed' ||
      started.exchange.status === 'cancelled';
    return {
      chatId: started.chatId,
      exchangeId: started.exchange.id,
      done: null,
      failure: failed
        ? (started.exchange.error ?? 'The answer did not complete.')
        : null,
      detached: !failed,
      questionId: started.exchange.questionId,
      lastEventSeq: started.exchange.lastEventSeq,
    };
  }
  return watchChatExchange(started, onEvent, opts);
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
