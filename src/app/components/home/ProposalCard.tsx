import { useState } from 'react';
import { useToast } from '@/components/feedback/Toast';
import { Badge, PromptCategoryTag } from '@/components/ui';
import { api, useAsyncAction } from '@/lib/api';
import type { ChatMessage, ChatProposal } from '@/lib/types';

// The confirmation gate for agent write drafts: nothing in a proposal exists
// until a human applies it here, and applying runs the same validated
// endpoints as the dashboard. A resolved proposal stays visible with its
// outcome so the conversation reads as a record.
export const ProposalCard = ({
  chatId,
  message,
  onResolved,
}: {
  chatId: number;
  message: ChatMessage;
  onResolved: (messageId: number, proposal: ChatProposal) => void;
}) => {
  const proposal = message.proposal;
  const [selected, setSelected] = useState<Set<number>>(
    () =>
      new Set(
        proposal?.kind === 'prompts'
          ? proposal.items.map((_, index) => index)
          : [],
      ),
  );
  const { busy, error, run } = useAsyncAction();
  const toast = useToast();
  if (!proposal) {
    return null;
  }
  const resolved = proposal.status !== 'pending';

  const act = (action: 'apply' | 'dismiss') => {
    void run(async () => {
      const res = await api<{ proposal: ChatProposal }>(
        `/chat/${chatId}/messages/${message.id}/proposal`,
        {
          method: 'POST',
          body: JSON.stringify({
            action,
            selected:
              action === 'apply' && proposal.kind === 'prompts'
                ? [...selected]
                : [],
          }),
        },
      );
      onResolved(message.id, res.proposal);
      toast(
        res.proposal.summary ??
          (action === 'dismiss' ? 'proposal dismissed' : 'applied'),
      );
    });
  };

  const toggle = (index: number) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  return (
    <div className="mt-3 overflow-hidden border border-border bg-bg-card">
      <div className="flex items-center justify-between gap-3 border-border border-b bg-bg-elevated px-3 py-2">
        <p className="section-label">
          {proposal.kind === 'prompts'
            ? `proposed prompts · ${proposal.items.length}`
            : 'proposed competitor'}
        </p>
        {resolved ? (
          <Badge tone={proposal.status === 'applied' ? 'ok' : 'neutral'}>
            {proposal.summary ?? proposal.status}
          </Badge>
        ) : null}
      </div>

      {proposal.kind === 'prompts' ? (
        <ul>
          {proposal.items.map((item, index) => (
            <li
              key={item.text}
              className="border-border border-t px-3 py-2 first:border-t-0"
            >
              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={resolved ? undefined : selected.has(index)}
                  defaultChecked={resolved ? true : undefined}
                  disabled={resolved || busy}
                  onChange={() => toggle(index)}
                  className="mt-0.5 accent-current"
                />
                <span className="min-w-0 flex-1 text-[13px] text-primary leading-snug">
                  {item.text}
                </span>
                {item.category ? (
                  <PromptCategoryTag category={item.category} />
                ) : null}
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col gap-1.5 px-3 py-2.5">
          <p className="text-[14px] text-primary">{proposal.name}</p>
          <p className="font-mono text-[11px] text-secondary">
            {proposal.domains.join(' · ')}
          </p>
          {proposal.aliases.length > 0 ? (
            <p className="font-mono text-[11px] text-muted">
              aliases:{' '}
              {proposal.aliases
                .map(
                  (alias) =>
                    `${alias.value}${alias.caseSensitive ? ' (exact case)' : ''}`,
                )
                .join(', ')}
            </p>
          ) : null}
        </div>
      )}

      {!resolved ? (
        <div className="flex items-center justify-between gap-3 border-border border-t px-3 py-2">
          <span className="font-mono text-[10px] text-muted uppercase tracking-[0.08em]">
            {proposal.kind === 'prompts'
              ? 'added prompts join the next collection run'
              : 'tracked from the next collection run'}
          </span>
          <span className="flex gap-2">
            <button
              type="button"
              className="btn-ghost h-7 px-2 font-mono text-[11px]"
              onClick={() => act('dismiss')}
              disabled={busy}
            >
              dismiss
            </button>
            <button
              type="button"
              className="btn-primary h-7 px-2.5 font-mono text-[11px]"
              onClick={() => act('apply')}
              disabled={
                busy || (proposal.kind === 'prompts' && selected.size === 0)
              }
            >
              {busy
                ? 'applying'
                : proposal.kind === 'prompts'
                  ? `add ${selected.size} prompt${selected.size === 1 ? '' : 's'}`
                  : 'add competitor'}
            </button>
          </span>
        </div>
      ) : null}
      {error ? (
        <p className="border-border border-t px-3 py-2 text-[12px] text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
};
