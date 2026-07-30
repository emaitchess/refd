import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import remarkGfm from 'remark-gfm';
import { DitherIcon } from '@/components/dither/DitherIcon';
import { Tooltip } from '@/components/dither-kit/tooltip';
import { Dots } from '@/components/feedback/Dots';
import { useToast } from '@/components/feedback/Toast';
import { ChatPanels } from '@/components/home/ChatPanels';
import { ProposalCard } from '@/components/home/ProposalCard';
import { EmptyState, SectionLabel } from '@/components/ui';
import { ANALYTICS_EVENTS, trackEvent } from '@/lib/analytics';
import { ApiError, api, apiStream, useAsyncAction, useQuery } from '@/lib/api';
import { clockTime, timestamp } from '@/lib/format';
import type {
  ChatListItem,
  ChatMessage,
  ChatProposal,
  ChatStep,
  ChatSuggestions,
} from '@/lib/types';

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

// The honest work trace: real pipeline stages with real counts. Live it
// renders as a growing list; on stored messages it collapses to one line.
const ChatSteps = ({
  steps,
  durationMs,
  live = false,
}: {
  steps: ChatStep[] | null;
  durationMs?: number | null;
  live?: boolean;
}) => {
  const [open, setOpen] = useState(false);
  if (!steps || steps.length === 0) {
    return null;
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
// escaped markdown, no raw HTML passthrough.
const AssistantMessage = ({
  message,
  chatId,
  onProposalResolved,
}: {
  message: ChatMessage;
  chatId: number | null;
  onProposalResolved: (messageId: number, proposal: ChatProposal) => void;
}) => (
  <div className="max-w-[720px]">
    <ChatSteps steps={message.steps} durationMs={message.durationMs} />
    <div className="md-body text-[14px] leading-relaxed">
      <Markdown remarkPlugins={[remarkGfm]}>{message.content}</Markdown>
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
            source.url.startsWith('http') ? (
              <li key={source.url}>
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
    <Tooltip
      asChild
      content={`${timestamp(message.createdAt)} UTC`}
      delay={400}
      className="border-border-strong bg-bg-elevated text-primary shadow-lg"
    >
      <p className="mt-2 font-mono text-[10px] text-muted">
        {clockTime(message.createdAt)}
      </p>
    </Tooltip>
  </div>
);

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
  // The in-flight answer: steps and prose accumulate as SSE events arrive,
  // then the stored message pair replaces the whole thing.
  const [live, setLive] = useState<{
    steps: ChatStep[];
    content: string;
  } | null>(null);
  const [input, setInput] = useState('');
  const { busy, error, setError, run } = useAsyncAction();
  const openAction = useAsyncAction();
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const toast = useToast();
  // The Overview "what changed" card links here with the event pre-phrased
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

  useEffect(() => {
    if (messages.length > 0) {
      endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
    }
  }, [messages.length]);

  // Follow the stream: keep the growing answer in view without smooth-scroll
  // fighting every token.
  useEffect(() => {
    if (live) {
      endRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [live]);

  // Load the thread the URL names; skip when it is the one already in state
  // (the just-created chat navigates here with its messages in hand).
  const { run: runOpen } = openAction;
  useEffect(() => {
    if (chatId === null) {
      setLoadedId(null);
      setTitle('');
      setMessages([]);
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
    });
  }, [chatId, loadedId, runOpen]);

  const send = (raw: string) => {
    const text = raw.trim();
    if (!text || busy) {
      return;
    }
    setInput('');
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
    setLive({ steps: [], content: '' });
    void run(async () => {
      try {
        const path = chatId === null ? '/chat' : `/chat/${chatId}/messages`;
        let done: {
          chatId?: number;
          title?: string;
          messages?: ChatMessage[];
        } | null = null;
        let streamError: string | null = null;
        await apiStream(
          path,
          { method: 'POST', body: JSON.stringify({ message: text }) },
          (event) => {
            if (event.type === 'step' && typeof event.label === 'string') {
              const step: ChatStep = {
                label: event.label,
                ...(typeof event.detail === 'string'
                  ? { detail: event.detail }
                  : {}),
              };
              setLive((cur) =>
                cur ? { ...cur, steps: [...cur.steps, step] } : cur,
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
              done = event as {
                chatId?: number;
                title?: string;
                messages?: ChatMessage[];
              };
            } else if (
              event.type === 'error' &&
              typeof event.message === 'string'
            ) {
              streamError = event.message;
            }
          },
        );
        if (streamError !== null) {
          throw new ApiError(500, streamError);
        }
        const finished = done as {
          chatId?: number;
          title?: string;
          messages?: ChatMessage[];
        } | null;
        if (!finished?.messages) {
          throw new ApiError(500, 'the answer stream ended unexpectedly');
        }
        if (chatId === null) {
          // State first, then the URL: loadedId matching the new param stops
          // the loader effect from refetching what is already in hand.
          setLoadedId(finished.chatId ?? null);
          setTitle(finished.title ?? '');
          setMessages(finished.messages);
          if (finished.chatId) {
            navigate(`/home/${finished.chatId}`, { replace: true });
          }
        } else {
          setMessages((current) => [
            ...current.filter((m) => m.id > 0),
            ...(finished.messages ?? []),
          ]);
        }
        listQ.refetch();
      } catch (cause) {
        // Roll the optimistic bubble back so the thread matches the server.
        setMessages((current) => current.filter((m) => m.id > 0));
        setInput(text);
        throw cause;
      } finally {
        setLive(null);
      }
    });
  };

  const openChat = (id: number) => {
    setError(null);
    navigate(`/home/${id}`);
  };

  const newChat = () => {
    setError(null);
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
    void openAction.run(async () => {
      await api(`/chat/${id}`, { method: 'DELETE', body: '{}' });
      toast('conversation deleted');
      if (id === chatId) {
        newChat();
      }
      listQ.refetch();
    });
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
      <div className="flex items-center justify-between px-3 pb-2.5">
        <span className="font-mono text-[10px] text-muted uppercase tracking-[0.08em]">
          workspace data only · last 30 days unless you name a range
        </span>
        <button
          type="submit"
          disabled={busy || input.trim().length === 0}
          aria-label="Send question"
          className="btn-primary h-8 px-3 font-mono text-[12px]"
        >
          {busy ? 'thinking' : 'ask'}
        </button>
      </div>
    </form>
  );

  const recentChats = listQ.data?.chats ?? [];

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
                key={s}
                type="button"
                onClick={() => send(s)}
                disabled={busy}
                className="border border-border bg-bg-card px-3 py-1.5 text-[12px] text-secondary transition-colors hover:border-border-strong hover:text-primary"
              >
                {s}
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
                  className="flex items-center gap-2 border-border border-t first:border-t-0"
                >
                  <button
                    type="button"
                    onClick={() => openChat(chat.id)}
                    className="flex min-w-0 flex-1 cursor-pointer items-baseline justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-bg-card-hover"
                  >
                    <span className="truncate text-[13px] text-primary">
                      {chat.title}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-muted">
                      {timestamp(chat.updatedAt)}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete conversation: ${chat.title}`}
                    onClick={() => deleteChat(chat.id)}
                    className="mr-2 flex size-7 shrink-0 cursor-pointer items-center justify-center text-muted transition-colors hover:text-error"
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
            content="Back to home"
            className="border-border-strong bg-bg-elevated text-primary shadow-lg"
          >
            <button
              type="button"
              onClick={newChat}
              aria-label="Back to home"
              className="flex size-8 shrink-0 items-center justify-center border border-border text-secondary transition-colors hover:border-border-strong hover:text-primary"
            >
              <DitherIcon name="arrow-left" size={12} />
            </button>
          </Tooltip>
          <p className="min-w-0 truncate text-[13px] text-primary">{title}</p>
        </div>
        <button
          type="button"
          onClick={newChat}
          className="btn-secondary h-8 shrink-0 px-3 font-mono text-[11px]"
        >
          new conversation
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-6 py-6">
        {messages.map((message) =>
          message.role === 'user' ? (
            <div key={message.id} className="flex flex-col items-end self-end">
              <div className="max-w-[560px] border border-border bg-bg-elevated px-4 py-2.5 text-[14px] text-primary">
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
            <div key={message.id} className="self-start">
              <AssistantMessage
                message={message}
                chatId={chatId ?? loadedId}
                onProposalResolved={handleProposalResolved}
              />
            </div>
          ),
        )}
        {live ? (
          <div className="max-w-[720px] self-start">
            <ChatSteps steps={live.steps} live />
            {live.content ? (
              <div className="md-body text-[14px] leading-relaxed">
                <Markdown remarkPlugins={[remarkGfm]}>{live.content}</Markdown>
              </div>
            ) : (
              <p className="font-mono text-[12px] text-muted">
                working
                <Dots />
              </p>
            )}
          </div>
        ) : null}
        {error ? <p className="text-[13px] text-error">{error}</p> : null}
        {openAction.error ? (
          <p className="text-[13px] text-error">{openAction.error}</p>
        ) : null}
        {messages.length === 0 && openAction.busy ? (
          <EmptyState title="loading conversation" className="min-h-40" />
        ) : null}
        <div ref={endRef} />
      </div>

      {/* Solid band under the sticky composer: bg-bg-card is translucent by
          design, so without this the thread scrolls through the input. */}
      <div className="sticky bottom-0 bg-bg pt-2 pb-4">{composer(false)}</div>
    </div>
  );
};
