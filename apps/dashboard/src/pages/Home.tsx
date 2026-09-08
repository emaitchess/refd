import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import remarkGfm from 'remark-gfm';
import { z } from 'zod';
import { DitherIcon } from '@/components/dither/DitherIcon';
import { Tooltip } from '@/components/dither-kit/tooltip';
import { DitherLoader } from '@/components/feedback/DitherLoader';
import { Dots } from '@/components/feedback/Dots';
import { Elapsed } from '@/components/feedback/Elapsed';
import { useToast } from '@/components/feedback/Toast';
import { ChatPanels } from '@/components/home/ChatPanels';
import { ProposalCard } from '@/components/home/ProposalCard';
import { EmptyState, SectionLabel } from '@/components/ui';
import { ANALYTICS_EVENTS, trackEvent } from '@/lib/analytics';
import {
  ApiError,
  api,
  apiExchange,
  useAsyncAction,
  useQuery,
} from '@/lib/api';
import { collectLinkedSources, rehypeLinkSources } from '@/lib/citations';
import { clockTime, dayLabel, relativeTime, timestamp } from '@/lib/format';
import type {
  ChatListItem,
  ChatMessage,
  ChatProposal,
  ChatStep,
  ChatSuggestions,
} from '@/lib/types';
import { cn } from '@/lib/utils';

const greeting = (): string => {
  const hour = new Date().getHours();
  if (hour < 5) {
    return 'Night owl hours';
  }
  if (hour < 12) {
    return 'Morning';
  }
  if (hour < 18) {
    return 'Afternoon';
  }
  return 'Evening';
};

const utcDay = (epochMs: number): string =>
  new Date(epochMs).toISOString().slice(0, 10);

// Lenient intake for the exchange's terminal frame: require the essential
// shape (a message pair), catch per-field drift so one odd field never
// discards an otherwise usable answer.
const chatMessage = z.object({
  id: z.number().int(),
  role: z.enum(['user', 'assistant']),
  content: z.string().transform((s) => s.slice(0, 20000)),
  panels: z.array(z.string()).nullable().catch(null),
  panelData: z.record(z.string(), z.unknown()).nullable().catch(null),
  links: z
    .array(
      z.object({
        label: z.string().transform((s) => s.slice(0, 120)),
        to: z.string().transform((s) => s.slice(0, 512)),
      }),
    )
    .nullable()
    .catch(null),
  steps: z
    .array(
      z.object({
        label: z.string().transform((s) => s.slice(0, 120)),
        detail: z
          .string()
          .transform((s) => s.slice(0, 300))
          .optional(),
      }),
    )
    .nullable()
    .catch(null),
  durationMs: z.number().nullable().catch(null),
  proposal: z
    .discriminatedUnion('kind', [
      z.object({
        kind: z.literal('prompts'),
        items: z
          .array(
            z.object({
              text: z.string().transform((s) => s.slice(0, 500)),
              category: z.string().optional(),
            }),
          )
          .min(1),
        status: z.enum(['pending', 'applied', 'dismissed']),
        summary: z.string().optional(),
      }),
      z.object({
        kind: z.literal('competitor'),
        name: z.string().transform((s) => s.slice(0, 200)),
        domains: z
          .array(z.string().transform((s) => s.slice(0, 2048)))
          .catch([]),
        aliases: z
          .array(
            z.object({
              value: z.string(),
              caseSensitive: z.boolean().optional(),
            }),
          )
          .catch([]),
        status: z.enum(['pending', 'applied', 'dismissed']),
        summary: z.string().optional(),
      }),
    ])
    .nullable()
    .catch(null),
  sources: z
    .array(
      z.object({
        title: z.string().transform((s) => s.slice(0, 200)),
        url: z.string().transform((s) => s.slice(0, 2048)),
        num: z.number().int().positive().optional().catch(undefined),
      }),
    )
    .nullable()
    .catch(null),
  createdAt: z.number(),
});

const doneFrame = z.object({
  chatId: z.number().int().positive().catch(0),
  title: z.string().catch(''),
  messages: z.array(chatMessage).min(1),
});

// The honest work trace: real pipeline stages with real counts. Live it
// renders as a growing list; once prose is streaming it collapses to the
// newest line so the trace stops shoving the answer down the screen; on
// stored messages it collapses to one line.
const ChatSteps = ({
  steps,
  durationMs,
  live = false,
  compact = false,
}: {
  steps: ChatStep[] | null;
  durationMs?: number | null;
  live?: boolean;
  compact?: boolean;
}) => {
  const [open, setOpen] = useState(false);
  if (!steps || steps.length === 0) {
    return null;
  }
  if (live && compact) {
    const last = steps.at(-1);
    return (
      <div className="mb-2">
        <p className="font-mono text-[11px] text-muted">
          <span className="text-secondary">{last?.label ?? 'working'}</span>
          {last?.detail ? <span> · {last.detail}</span> : null}
        </p>
      </div>
    );
  }
  const list = (
    <ol className="flex flex-col gap-1 border-border border-l pl-3">
      {steps.map((step) => (
        <li key={step.label} className="font-mono text-[11px] text-muted">
          <span className="text-secondary">{step.label}</span>
          {step.detail ? <span> · {step.detail}</span> : null}
        </li>
      ))}
    </ol>
  );
  if (live) {
    return <div className="mb-3">{list}</div>;
  }
  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="font-mono text-[10px] text-muted uppercase tracking-[0.08em] transition-colors hover:text-primary"
      >
        {open
          ? 'hide work'
          : `worked for ${durationMs != null ? (durationMs / 1000).toFixed(1) : '?'}s · ${steps.length} steps`}
      </button>
      {open ? <div className="mt-2">{list}</div> : null}
    </div>
  );
};

// Assistant prose renders like every other model-written text in the app:
// escaped markdown, no raw HTML passthrough, citation markers linked only to
// sources this message actually carries.
const AssistantMessage = ({
  message,
  chatId,
  onProposalResolved,
}: {
  message: ChatMessage;
  chatId: number | null;
  onProposalResolved: (messageId: number, proposal: ChatProposal) => void;
}) => {
  const [copied, setCopied] = useState(false);
  const linkedSources = useMemo(
    () => collectLinkedSources(message.sources),
    [message.sources],
  );
  const copy = () => {
    void navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div className="max-w-[720px]">
      <ChatSteps steps={message.steps} durationMs={message.durationMs} />
      <div className="md-body text-[14px] leading-relaxed">
        <Markdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeLinkSources(linkedSources)]}
        >
          {message.content}
        </Markdown>
      </div>
      <ChatPanels panels={message.panels} panelData={message.panelData} />
      {message.proposal && chatId !== null ? (
        <ProposalCard
          chatId={chatId}
          message={message}
          onResolved={onProposalResolved}
        />
      ) : null}
      {message.sources && message.sources.length > 0 ? (
        <div className="mt-3">
          <p className="font-mono text-[10px] text-muted uppercase tracking-[0.08em]">
            from the web
          </p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {message.sources.map((source, index) =>
              /^https?:\/\//i.test(source.url) ? (
                <li key={index}>
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer nofollow"
                    className="font-mono text-[11px] text-secondary underline-offset-2 transition-colors hover:text-primary hover:underline"
                  >
                    S{source.num ?? index + 1} · {source.title}
                  </a>
                </li>
              ) : null,
            )}
          </ul>
        </div>
      ) : null}
      {message.links && message.links.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {message.links.map((link) => (
            <Link
              key={`${link.to}:${link.label}`}
              to={link.to}
              className="btn-secondary h-7 gap-1.5 px-2.5 text-[11px]"
            >
              {link.label}
              <span aria-hidden>↗</span>
            </Link>
          ))}
        </div>
      ) : null}
      <div className="mt-2 flex items-center gap-3">
        <Tooltip
          asChild
          content={`${timestamp(message.createdAt)} UTC`}
          delay={400}
          className="border-border-strong bg-bg-elevated text-primary shadow-lg"
        >
          <p className="font-mono text-[10px] text-muted">
            {clockTime(message.createdAt)}
          </p>
        </Tooltip>
        <Tooltip
          asChild
          content={copied ? 'copied' : 'copy answer'}
          delay={200}
          className="border-border-strong bg-bg-elevated text-primary shadow-lg"
        >
          <button
            type="button"
            onClick={copy}
            aria-label={copied ? 'Answer copied' : 'Copy answer'}
            className="flex items-center gap-1 font-mono text-[10px] text-muted transition-colors hover:text-primary"
          >
            <DitherIcon name={copied ? 'check' : 'copy'} size={10} />
            {copied ? 'copied' : 'copy'}
          </button>
        </Tooltip>
      </div>
    </div>
  );
};

export const Home = () => {
  const suggestionsQ = useQuery<ChatSuggestions>('/chat/suggestions');
  const listQ = useQuery<{ chats: ChatListItem[] }>('/chat');
  const navigate = useNavigate();
  // The conversation lives in the URL so a reload (or a shared link) lands
  // back in the same thread; /home with no id is the idle ask screen.
  const params = useParams();
  const parsedId = params.chatId ? Number.parseInt(params.chatId, 10) : NaN;
  const chatId = Number.isFinite(parsedId) ? parsedId : null;
  const [loadedId, setLoadedId] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // The in-flight answer: steps and prose accumulate as stream events arrive,
  // then the stored message pair replaces the whole thing. `since` names when
  // the newest step arrived, so the wait is measured from the last real event
  // rather than from the start of the whole exchange.
  const [live, setLive] = useState<{
    steps: ChatStep[];
    content: string;
    since: number;
  } | null>(null);
  const [input, setInput] = useState('');
  // The chat the thread is currently showing, so the post-stop poll only
  // applies what it fetched when this thread is still on screen.
  const activeChatRef = useRef<number | null>(null);
  useEffect(() => {
    activeChatRef.current = chatId ?? loadedId;
  }, [chatId, loadedId]);
  const [deleteBusyId, setDeleteBusyId] = useState<number | null>(null);
  // Set while a stopped exchange is still running server-side; the stored
  // pair lands in D1 when it finishes, and the poll refills the thread then.
  const [detached, setDetached] = useState<number | null>(null);
  const pollTokenRef = useRef(0);
  const stopRef = useRef<AbortController | null>(null);
  const [announce, setAnnounce] = useState('');
  const { busy, error, setError, run } = useAsyncAction();
  const openAction = useAsyncAction();
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const toast = useToast();

  // Follow-the-stream contract: the thread keeps the growing answer in view
  // only while the user is at the bottom. Scrolling up detaches the follow
  // (a pill offers the way back down); no yank per token.
  const [atBottom, setAtBottom] = useState(true);
  const followRef = useRef(true);
  const prevCountRef = useRef(0);

  useEffect(() => {
    const onScroll = () => {
      const distance =
        document.documentElement.scrollHeight -
        window.innerHeight -
        window.scrollY;
      const at = distance < 96;
      followRef.current = at;
      setAtBottom(at);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // New/loaded messages: jump instantly on open, glide on append. The
  // scroll-mb on the end anchor keeps the newest content clear of the
  // sticky composer that overlays the viewport bottom.
  useEffect(() => {
    const count = messages.length;
    const prev = prevCountRef.current;
    prevCountRef.current = count;
    if (count === 0 || !followRef.current) {
      return;
    }
    endRef.current?.scrollIntoView({
      block: 'end',
      behavior: prev === 0 ? 'auto' : 'smooth',
    });
  }, [messages.length]);

  // Follow the stream without smooth-scroll fighting every token.
  useEffect(() => {
    if (live && followRef.current) {
      endRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [live]);

  // Relative dates on the recent list go stale while the page sits open;
  // the idle screen reticks so "now" does not become a lie.
  const [, setRelativeTick] = useState(0);
  useEffect(() => {
    if (chatId !== null) {
      return;
    }
    const id = window.setInterval(() => setRelativeTick((v) => v + 1), 30_000);
    return () => window.clearInterval(id);
  }, [chatId]);

  // The Overview "what changed" card links here with the question pre-phrased
  // as ?ask=. Prefill only — the user reviews and sends; nothing auto-fires.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const ask = searchParams.get('ask');
    if (ask !== null && chatId === null) {
      setInput(ask);
      setSearchParams({}, { replace: true });
      inputRef.current?.focus();
    }
  }, [searchParams, chatId, setSearchParams]);

  // Load the thread the URL names; skip when it is the one already in state
  // (the just-created chat navigates here with its messages in hand).
  const { run: runOpen } = openAction;
  useEffect(() => {
    if (chatId === null) {
      setLoadedId(null);
      setTitle('');
      setMessages([]);
      setDetached(null);
      return;
    }
    if (chatId === loadedId) {
      return;
    }
    void runOpen(async () => {
      const res = await api<{
        chatId: number;
        title: string;
        messages: ChatMessage[];
      }>(`/chat/${chatId}`);
      setLoadedId(res.chatId);
      setTitle(res.title);
      setMessages(res.messages);
      setDetached(null);
    });
  }, [chatId, loadedId, runOpen, setDetached]);

  // After a stop the exchange keeps running server-side; poll until the
  // stored pair lands in D1, then refill the thread with the real answer.
  const pollForStoredPair = (id: number) => {
    const token = ++pollTokenRef.current;
    let attempt = 0;
    const next = () => {
      attempt += 1;
      void api<{ chatId: number; title: string; messages: ChatMessage[] }>(
        `/chat/${id}`,
      )
        .then((res) => {
          if (pollTokenRef.current !== token) {
            return;
          }
          const answered = res.messages.some((m) => m.role === 'assistant');
          if (!answered && attempt < 12) {
            window.setTimeout(next, 10_000);
            return;
          }
          setDetached(null);
          if (activeChatRef.current === id && res.messages.length > 0) {
            setTitle(res.title);
            setMessages(res.messages);
            suggestionsQ.refetch();
          }
          listQ.refetch();
        })
        .catch(() => {});
    };
    window.setTimeout(next, 10_000);
  };

  const send = (raw: string) => {
    const text = raw.trim();
    if (!text || busy) {
      return;
    }
    setInput('');
    inputRef.current?.focus();
    followRef.current = true;
    setAtBottom(true);
    // Name only. The question itself never leaves the Service.
    trackEvent(ANALYTICS_EVENTS.chatMessageSent, {
      chat: chatId === null ? 'new' : 'existing',
    });
    // Optimistic user bubble; the server's stored pair replaces it.
    setMessages((current) => [
      ...current,
      {
        id: -Date.now(),
        role: 'user',
        content: text,
        panels: null,
        panelData: null,
        links: null,
        steps: null,
        durationMs: null,
        proposal: null,
        sources: null,
        createdAt: Date.now(),
      },
    ]);
    setLive({ steps: [], content: '', since: Date.now() });
    setDetached(null);
    const controller = new AbortController();
    stopRef.current = controller;
    void run(async () => {
      try {
        const path = chatId === null ? '/chat' : `/chat/${chatId}/messages`;
        // Held in an object because tsc narrows a let to its initial literal
        // when every write happens inside a closure.
        const stream: {
          done: Record<string, unknown> | null;
          error: string | null;
        } = { done: null, error: null };
        const exchangeChatId = await apiExchange(
          path,
          { message: text },
          (event) => {
            if (event.type === 'step' && typeof event.label === 'string') {
              const step: ChatStep = {
                label: event.label,
                ...(typeof event.detail === 'string'
                  ? { detail: event.detail }
                  : {}),
              };
              setLive((cur) =>
                cur
                  ? { ...cur, steps: [...cur.steps, step], since: Date.now() }
                  : cur,
              );
            } else if (
              event.type === 'delta' &&
              typeof event.text === 'string'
            ) {
              const delta = event.text;
              setLive((cur) =>
                cur ? { ...cur, content: cur.content + delta } : cur,
              );
            } else if (event.type === 'done') {
              stream.done = event;
            } else if (
              event.type === 'error' &&
              typeof event.message === 'string'
            ) {
              stream.error = event.message;
            }
          },
          { signal: controller.signal },
        );
        if (stream.error !== null) {
          throw new ApiError(500, stream.error);
        }
        if (controller.signal.aborted) {
          // Detached watcher, running exchange: the user bubble is real (the
          // POST succeeded), so keep it and poll for the stored pair instead
          // of rolling it back.
          setDetached(exchangeChatId);
          if (chatId === null) {
            setLoadedId(exchangeChatId);
            navigate(`/home/${exchangeChatId}`, { replace: true });
          }
          pollForStoredPair(exchangeChatId);
          listQ.refetch();
          return;
        }
        const parsed = doneFrame.safeParse(stream.done);
        if (!parsed.success) {
          throw new ApiError(
            500,
            'the answer stream carried an unexpected shape',
          );
        }
        const finished = parsed.data;
        const answerId = finished.chatId || exchangeChatId;
        const answerText = finished.messages.at(-1)?.content ?? '';
        setAnnounce(`answer ready: ${answerText.slice(0, 120)}`);
        if (chatId === null) {
          // State first, then the URL: loadedId matching the new param stops
          // the loader effect from refetching what is already in hand.
          setLoadedId(answerId || null);
          setTitle(finished.title);
          setMessages(finished.messages);
          if (answerId) {
            navigate(`/home/${answerId}`, { replace: true });
          }
        } else {
          setMessages((current) => [
            ...current.filter((m) => m.id > 0),
            ...finished.messages,
          ]);
        }
        suggestionsQ.refetch();
        listQ.refetch();
      } catch (cause) {
        // Roll the optimistic bubble back so the thread matches the server.
        setMessages((current) => current.filter((m) => m.id > 0));
        setInput(text);
        setAnnounce('answering failed');
        throw cause;
      } finally {
        stopRef.current = null;
        setLive(null);
      }
    });
  };

  const stop = () => {
    stopRef.current?.abort();
  };

  const jumpToLatest = () => {
    followRef.current = true;
    setAtBottom(true);
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  };

  const openChat = (id: number) => {
    setError(null);
    navigate(`/home/${id}`);
  };

  const newChat = () => {
    setError(null);
    setDetached(null);
    navigate('/home');
    suggestionsQ.refetch();
    inputRef.current?.focus();
  };

  const handleProposalResolved = (
    messageId: number,
    proposal: ChatProposal,
  ) => {
    setMessages((current) =>
      current.map((m) => (m.id === messageId ? { ...m, proposal } : m)),
    );
    // A new competitor or prompt changes what the idle chips suggest.
    suggestionsQ.refetch();
  };

  const deleteChat = (id: number) => {
    if (deleteBusyId !== null) {
      return;
    }
    setDeleteBusyId(id);
    void api(`/chat/${id}`, { method: 'DELETE', body: '{}' })
      .then(() => {
        toast('conversation deleted');
        if (id === chatId) {
          newChat();
        }
        listQ.refetch();
      })
      .catch((cause: unknown) => {
        toast(cause instanceof Error ? cause.message : 'delete failed');
      })
      .finally(() => setDeleteBusyId(null));
  };

  const composer = (autoFocus: boolean) => (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        send(input);
      }}
      className="border border-border bg-bg-elevated focus-within:border-border-strong"
    >
      <textarea
        ref={inputRef}
        rows={2}
        value={input}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            send(input);
          }
        }}
        placeholder={
          suggestionsQ.data?.brand
            ? `Ask about ${suggestionsQ.data.brand}'s AI search presence`
            : 'Ask about your AI search presence'
        }
        aria-label="Ask about your workspace data"
        maxLength={1000}
        autoFocus={autoFocus}
        className="w-full resize-none bg-transparent px-4 pt-3 text-[14px] text-primary outline-none placeholder:text-muted"
      />
      <div className="flex items-center justify-between gap-3 px-3 pb-2.5">
        <span className="min-w-0 truncate font-mono text-[10px] text-muted uppercase tracking-[0.08em]">
          workspace data only · last 30 days unless you name a range
          {input.length > 800 ? ` · ${1000 - input.length} left` : ''}
        </span>
        {busy ? (
          <button
            type="button"
            onClick={stop}
            aria-label="Stop answering"
            className="btn-secondary h-8 shrink-0 px-3 font-mono text-[12px]"
          >
            stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={input.trim().length === 0}
            aria-label="Send question"
            className="btn-primary h-8 shrink-0 px-3 font-mono text-[12px]"
          >
            ask
          </button>
        )}
      </div>
    </form>
  );

  const recentChats = listQ.data?.chats ?? [];
  const followUps =
    !busy && !live && messages.length > 0
      ? (suggestionsQ.data?.suggestions ?? []).slice(0, 4)
      : [];

  if (chatId === null && messages.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-8 py-10 sm:py-16">
        <div className="text-center">
          <p className="font-mono text-[10px] text-accent uppercase tracking-[0.16em]">
            home
          </p>
          <h1 className="mt-4 text-balance font-medium text-[32px] text-primary leading-[1.1] tracking-[-0.03em] sm:text-[40px]">
            {greeting()}
            {suggestionsQ.data?.name ? `, ${suggestionsQ.data.name}` : ''}
          </h1>
          <p className="mt-3 text-[14px] text-secondary">
            {suggestionsQ.data?.brand
              ? `Ask anything about ${suggestionsQ.data.brand}'s AI search presence.`
              : 'Ask anything about your AI search presence.'}{' '}
            Every answer is grounded in your workspace's own numbers.
          </p>
        </div>

        {composer(true)}
        {error ? <p className="text-[13px] text-error">{error}</p> : null}

        {(suggestionsQ.data?.suggestions.length ?? 0) > 0 ? (
          <div className="flex flex-wrap justify-center gap-2">
            {suggestionsQ.data?.suggestions.map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => send(s.question)}
                disabled={busy}
                title={s.question}
                className="border border-border bg-bg-card px-3 py-1.5 text-left text-[12px] text-secondary transition-colors hover:border-border-strong hover:text-primary"
              >
                {s.label}
              </button>
            ))}
          </div>
        ) : null}

        {recentChats.length > 0 ? (
          <section>
            <SectionLabel>recent conversations</SectionLabel>
            <ul className="mt-2 border border-border bg-bg-card">
              {recentChats.slice(0, 8).map((chat) => (
                <li
                  key={chat.id}
                  className={cn(
                    'group flex items-center gap-2 border-border border-t transition-opacity first:border-t-0',
                    deleteBusyId === chat.id &&
                      'pointer-events-none opacity-50',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => openChat(chat.id)}
                    disabled={deleteBusyId !== null}
                    className="flex min-w-0 flex-1 cursor-pointer items-baseline justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-bg-card-hover disabled:cursor-default"
                  >
                    <span className="truncate text-[13px] text-primary">
                      {chat.title}
                    </span>
                    <span
                      className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] text-muted"
                      title={timestamp(chat.updatedAt)}
                    >
                      {deleteBusyId === chat.id ? (
                        <>
                          <DitherLoader size={10} />
                          <span>deleting</span>
                        </>
                      ) : chat.running ? (
                        <>
                          <DitherLoader size={10} />
                          <span>working</span>
                        </>
                      ) : (
                        relativeTime(chat.updatedAt)
                      )}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete conversation: ${chat.title}`}
                    onClick={() => deleteChat(chat.id)}
                    disabled={deleteBusyId !== null}
                    className="mr-2 flex size-7 shrink-0 cursor-pointer items-center justify-center text-muted opacity-0 transition-opacity hover:text-error focus-visible:opacity-100 disabled:cursor-default group-hover:opacity-100"
                  >
                    <DitherIcon name="trash" size={12} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[calc(100svh-8rem)] w-full max-w-[860px] flex-col py-6">
      <div className="flex items-center justify-between gap-3 border-border border-b pb-3">
        <div className="flex min-w-0 items-center gap-2">
          <Tooltip
            asChild
            content="Back to conversations"
            className="border-border-strong bg-bg-elevated text-primary shadow-lg"
          >
            <button
              type="button"
              onClick={newChat}
              aria-label="Back to conversations"
              className="flex size-8 shrink-0 items-center justify-center border border-border text-secondary transition-colors hover:border-border-strong hover:text-primary"
            >
              <DitherIcon name="arrow-left" size={12} />
            </button>
          </Tooltip>
          <p className="min-w-0 truncate text-[13px] text-primary">{title}</p>
        </div>
      </div>

      <div
        role="log"
        aria-label="conversation"
        aria-busy={live !== null}
        className="flex flex-1 flex-col gap-6 py-6"
      >
        <p role="status" aria-live="polite" className="sr-only">
          {announce}
        </p>
        {messages.map((message, index) => {
          const previous = index > 0 ? messages[index - 1] : undefined;
          const newDay =
            previous !== undefined &&
            utcDay(previous.createdAt) !== utcDay(message.createdAt);
          return (
            <Fragment key={message.id}>
              {newDay ? (
                <div className="flex items-center gap-3" aria-hidden>
                  <div className="h-px flex-1 bg-border" />
                  <span className="font-mono text-[10px] text-muted uppercase tracking-[0.08em]">
                    {dayLabel(message.createdAt)}
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>
              ) : null}
              {message.role === 'user' ? (
                <div className="flex flex-col items-end self-end">
                  <div className="max-w-[560px] whitespace-pre-wrap border border-border bg-bg-elevated px-4 py-2.5 text-[14px] text-primary">
                    {message.content}
                  </div>
                  <Tooltip
                    asChild
                    content={`${timestamp(message.createdAt)} UTC`}
                    delay={400}
                    className="border-border-strong bg-bg-elevated text-primary shadow-lg"
                  >
                    <p className="mt-1 font-mono text-[10px] text-muted">
                      {clockTime(message.createdAt)}
                    </p>
                  </Tooltip>
                </div>
              ) : (
                <div className="self-start">
                  <AssistantMessage
                    message={message}
                    chatId={chatId ?? loadedId}
                    onProposalResolved={handleProposalResolved}
                  />
                </div>
              )}
            </Fragment>
          );
        })}
        {live ? (
          <div className="max-w-[720px] self-start">
            <ChatSteps steps={live.steps} live compact={live.content !== ''} />
            {live.content ? (
              <div className="md-body text-[14px] leading-relaxed">
                <Markdown remarkPlugins={[remarkGfm]}>{live.content}</Markdown>
              </div>
            ) : (
              <p className="flex items-center gap-2 font-mono text-[12px] text-muted">
                <DitherLoader />
                <span>
                  {live.steps.at(-1)?.label ?? 'working'}
                  <Dots />
                </span>
                <Elapsed since={live.since} />
              </p>
            )}
          </div>
        ) : null}
        {detached !== null ? (
          <p className="flex items-center gap-2 font-mono text-[11px] text-muted">
            <DitherLoader size={10} />
            <span>
              stopped watching · the answer lands here when it finishes
            </span>
          </p>
        ) : null}
        {followUps.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {followUps.map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => send(s.question)}
                disabled={busy}
                title={s.question}
                className="border border-border bg-bg-card px-3 py-1.5 text-left text-[12px] text-secondary transition-colors hover:border-border-strong hover:text-primary"
              >
                {s.label}
              </button>
            ))}
          </div>
        ) : null}
        {error ? <p className="text-[13px] text-error">{error}</p> : null}
        {openAction.error ? (
          <p className="text-[13px] text-error">{openAction.error}</p>
        ) : null}
        {messages.length === 0 && openAction.busy ? (
          <EmptyState title="loading conversation" className="min-h-40" />
        ) : null}
        <div ref={endRef} className="scroll-mb-36" />
      </div>

      {!atBottom && (messages.length > 0 || live !== null) ? (
        <button
          type="button"
          onClick={jumpToLatest}
          className="btn-secondary fixed bottom-36 left-1/2 z-10 h-7 -translate-x-1/2 gap-1.5 px-3 font-mono text-[10px] uppercase shadow-lg"
        >
          back to latest
          <span aria-hidden>↓</span>
        </button>
      ) : null}

      {/* Solid band under the sticky composer: bg-bg-card is translucent by
          design, so without this the thread scrolls through the input. */}
      <div className="sticky bottom-0 bg-bg pt-2 pb-4">{composer(false)}</div>
    </div>
  );
};
