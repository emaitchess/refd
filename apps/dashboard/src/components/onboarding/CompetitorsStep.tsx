import type { DragEndEvent } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { useEffect, useRef, useState } from 'react';
import { DitherIcon } from '@/components/dither/DitherIcon';
import { useToast } from '@/components/feedback/Toast';
import {
  LIST_DRAG,
  SortableGrid,
  SortableItem,
} from '@/components/table/sortable';
import { Favicon } from '@/components/ui';
import { onEnterKey, useEnterAdvance, useEscapeBack } from '@/lib/keyboard';
import {
  canRegenerate,
  type OnboardingFlow,
  STEP_TITLES,
} from '@/lib/onboarding';
import type { OnboardingCompetitor, OnboardingState } from '@/lib/types';
import { cn, domainFromUrl, handleDomainPaste } from '@/lib/utils';
import { RegenerateAction, StepCard } from './StepCard';
import { StepNav } from './StepNav';
import { STEP_ICONS } from './step-icons';
import {
  type StepNavigationRegistrar,
  useStepNavigation,
} from './step-navigation';

const MAX_COMPETITORS = 10;

// Step 3: competitors to track. On entry we auto-discover them (parallel.ai +
// glm-5.2); every failure degrades to manual add. Drag to reorder (order drives
// chart-color assignment). The draft is saved on both Continue and Back.
export const CompetitorsStep = ({
  flow,
  state,
  registerNavigation,
}: {
  flow: OnboardingFlow;
  state: OnboardingState;
  registerNavigation: StepNavigationRegistrar;
}) => {
  const [list, setList] = useState<OnboardingCompetitor[]>(
    state.profile.competitors,
  );
  const [name, setName] = useState('');
  const [domains, setDomains] = useState('');
  const [aliases, setAliases] = useState('');
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDomains, setEditDomains] = useState('');
  const [editAliases, setEditAliases] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [note, setNote] = useState<{
    tone: 'ok' | 'warn';
    text: string;
  } | null>(null);
  const started = useRef(false);
  const brandDomain = state.brand?.domains[0];
  const full = list.length >= MAX_COMPETITORS;
  const toast = useToast();

  const runSuggest = async (regenerate = false) => {
    setSuggesting(true);
    setNote(null);
    const res = await flow.suggestCompetitors(regenerate);
    setSuggesting(false);
    if (!res) {
      setNote({
        tone: 'warn',
        text: "couldn't reach the discovery service, so add competitors below",
      });
      return;
    }
    if (res.ok) {
      setList(res.state.profile.competitors.slice(0, MAX_COMPETITORS));
      setNote({
        tone: 'ok',
        text: 'found these competitors: reorder, add, or remove',
      });
      return;
    }
    setNote({
      tone: 'warn',
      text:
        res.reason === 'llm'
          ? 'no clear competitors found, so add them below'
          : "couldn't search the web, so add competitors below",
    });
  };

  // Auto-discover once on entry, only when the list is empty and we have a domain.
  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;
    if (list.length === 0 && brandDomain) {
      void runSuggest();
    }
  }, [list.length, brandDomain]);

  // Parse raw form values into a competitor, validating uniqueness against
  // `others` (the list minus the row being edited, when saving). Sets an error
  // and returns null on failure so add and save share one validation path.
  const parseCompetitor = (
    rawName: string,
    rawDomains: string,
    rawAliases: string,
    others: OnboardingCompetitor[],
  ): OnboardingCompetitor | null => {
    const n = rawName.trim();
    const domainList = rawDomains.split(',').map(domainFromUrl).filter(Boolean);
    const aliasList = rawAliases
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean)
      .map((value) => ({ value }));
    if (!n || domainList.length === 0) {
      flow.setError('add a competitor name and at least one domain');
      return null;
    }
    const takenDomains = new Set(others.flatMap((c) => c.domains));
    if (
      others.some((c) => c.name.toLowerCase() === n.toLowerCase()) ||
      domainList.some((d) => takenDomains.has(d))
    ) {
      flow.setError('that competitor is already in the list');
      return null;
    }
    return { name: n, domains: domainList, aliases: aliasList };
  };

  const add = () => {
    if (full) {
      flow.setError(`up to ${MAX_COMPETITORS} competitors`);
      return;
    }
    const comp = parseCompetitor(name, domains, aliases, list);
    if (!comp) {
      return;
    }
    setList((prev) => [...prev, comp]);
    setName('');
    setDomains('');
    setAliases('');
    flow.setError(null);
  };

  const startEdit = (comp: OnboardingCompetitor) => {
    setEditingName(comp.name);
    setEditName(comp.name);
    setEditDomains(comp.domains.join(', '));
    setEditAliases(comp.aliases.map((a) => a.value).join(', '));
    flow.setError(null);
  };

  const cancelEdit = () => {
    setEditingName(null);
    flow.setError(null);
  };

  const saveEdit = () => {
    const comp = parseCompetitor(
      editName,
      editDomains,
      editAliases,
      list.filter((c) => c.name !== editingName),
    );
    if (!comp) {
      return;
    }
    setList((prev) => prev.map((c) => (c.name === editingName ? comp : c)));
    cancelEdit();
  };

  const remove = (compName: string) => {
    if (compName === editingName) {
      cancelEdit();
    }
    setList((prev) => prev.filter((c) => c.name !== compName));
  };

  const next = () => {
    if (list.length === 0) {
      flow.setError('add at least one competitor to continue');
      return;
    }
    flow.patch({ competitors: list, step: 'prompts' });
  };
  const back = () => flow.patch({ competitors: list, step: 'describe' });
  useStepNavigation(
    registerNavigation,
    'competitors',
    (step) => flow.patch({ competitors: list, step }),
    list.length > 0,
  );
  useEnterAdvance(next, !flow.busy && !suggesting && list.length > 0);
  useEscapeBack(back, !flow.busy && !suggesting);

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }
    setList((cur) =>
      arrayMove(
        cur,
        cur.findIndex((c) => c.name === active.id),
        cur.findIndex((c) => c.name === over.id),
      ),
    );
  };

  // One re-search, then it's manual — the button stays live so the cap is
  // explained on click rather than silently greying out.
  const onRegenerate = () => {
    if (!canRegenerate(state, 'competitors')) {
      toast('You can search for competitors once. Add or remove them below.');
      return;
    }
    void runSuggest(true);
  };

  return (
    <StepCard
      step="competitors"
      title={STEP_TITLES.competitors}
      icon={STEP_ICONS.competitors}
      error={flow.error}
      action={
        brandDomain ? (
          <RegenerateAction
            loading={suggesting}
            loadingLabel="finding"
            label="search again"
            onClick={onRegenerate}
            disabled={flow.busy}
          />
        ) : undefined
      }
      footer={
        <StepNav
          onBack={back}
          onNext={next}
          busy={flow.busy}
          nextDisabled={suggesting || list.length === 0}
        />
      }
    >
      <p className="max-w-[590px] text-[14px] text-secondary leading-[1.7]">
        Add the brands buyers compare with you. Every future run scores this set
        for mentions, citations, and position. Order fixes their chart colors
        across the workspace.
      </p>

      {note ? (
        <p
          className={cn(
            'border border-border px-3 py-2.5 text-[12px] leading-[1.55]',
            note.tone === 'ok'
              ? 'bg-accent-soft text-secondary'
              : 'bg-bg-card text-muted',
          )}
        >
          {note.text}
        </p>
      ) : null}

      {list.length > 0 ? (
        <SortableGrid
          order={list.map((c) => c.name)}
          onDragEnd={onDragEnd}
          modifiers={LIST_DRAG}
          className="flex flex-col divide-y divide-border border border-border"
        >
          {list.map((comp) => (
            <SortableItem
              key={comp.name}
              id={comp.name}
              className={cn(
                'group/competitor px-3 py-2',
                editingName === comp.name && 'bg-accent-soft',
              )}
            >
              {(handleProps) => (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <button
                        type="button"
                        aria-label="Drag to reorder"
                        className="shrink-0 cursor-grab touch-none font-mono text-[13px] text-muted transition-colors hover:text-primary active:cursor-grabbing"
                        {...handleProps}
                      >
                        <DitherIcon name="grip" size={14} />
                      </button>
                      <Favicon domain={comp.domains[0] ?? ''} />
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-[13px] text-primary">
                          {comp.name}
                          {comp.aliases.length > 0 ? (
                            <span className="text-muted">
                              {' '}
                              aka {comp.aliases.map((a) => a.value).join(', ')}
                            </span>
                          ) : null}
                        </span>
                        <span className="truncate font-mono text-[11px] text-muted">
                          {comp.domains.join(', ')}
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center">
                      <button
                        type="button"
                        aria-label={
                          editingName === comp.name
                            ? `Stop editing: ${comp.name}`
                            : `Edit competitor: ${comp.name}`
                        }
                        className={cn(
                          'btn-ghost h-7 shrink-0 px-2 text-muted transition-[opacity,color] duration-150 hover:text-primary focus-visible:opacity-100 group-hover/competitor:opacity-100',
                          editingName === comp.name
                            ? 'text-primary opacity-100'
                            : 'opacity-0 pointer-coarse:opacity-100',
                        )}
                        onClick={() =>
                          editingName === comp.name
                            ? cancelEdit()
                            : startEdit(comp)
                        }
                      >
                        <DitherIcon name="pencil" size={14} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove competitor: ${comp.name}`}
                        className="btn-ghost h-7 shrink-0 px-2 text-muted opacity-0 pointer-coarse:opacity-100 transition-[opacity,color] duration-150 hover:text-error focus-visible:opacity-100 group-hover/competitor:opacity-100"
                        onClick={() => remove(comp.name)}
                      >
                        <DitherIcon name="trash" size={14} />
                      </button>
                    </div>
                  </div>
                  {editingName === comp.name ? (
                    <div className="mt-2.5 flex flex-col gap-2.5 border-border border-t pt-2.5">
                      <div className="grid gap-2.5 sm:grid-cols-2">
                        <label className="flex flex-col gap-1.5">
                          <span className="field-label">Competitor name</span>
                          <input
                            className="input"
                            placeholder="Acme"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={onEnterKey(saveEdit)}
                            maxLength={100}
                            autoFocus
                          />
                        </label>
                        <label className="flex flex-col gap-1.5">
                          <span className="field-label">Domains</span>
                          <input
                            className="input"
                            placeholder="acme.com"
                            value={editDomains}
                            onChange={(e) => setEditDomains(e.target.value)}
                            onKeyDown={onEnterKey(saveEdit)}
                            onPaste={(e) =>
                              handleDomainPaste(
                                e,
                                editDomains,
                                setEditDomains,
                                true,
                              )
                            }
                          />
                        </label>
                      </div>
                      <label className="flex flex-col gap-1.5">
                        <span className="field-label">Aliases (optional)</span>
                        <input
                          className="input"
                          placeholder="comma-separated alternate names"
                          value={editAliases}
                          onChange={(e) => setEditAliases(e.target.value)}
                          onKeyDown={onEnterKey(saveEdit)}
                          maxLength={400}
                        />
                      </label>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          className="btn-ghost h-8 px-3"
                          onClick={cancelEdit}
                        >
                          cancel
                        </button>
                        <button
                          type="button"
                          className="btn-secondary h-8 px-3"
                          onClick={saveEdit}
                        >
                          save changes
                        </button>
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </SortableItem>
          ))}
        </SortableGrid>
      ) : suggesting ? null : (
        <p className="border border-border border-dashed px-3 py-4 text-center text-[12px] text-muted">
          No competitors yet. Add at least one to continue.
        </p>
      )}

      {full ? (
        <p className="text-[11px] text-muted">
          Tracking the maximum of {MAX_COMPETITORS} competitors.
        </p>
      ) : (
        <div className="border border-border">
          <p className="border-border border-b px-3 py-2.5 font-mono text-[10px] text-muted uppercase tracking-[0.12em]">
            add manually
          </p>
          <div className="grid sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 border-border p-3 sm:border-r">
              <span className="field-label">Competitor name</span>
              <input
                className="input"
                placeholder="Acme"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={onEnterKey(add)}
                maxLength={100}
                disabled={suggesting}
              />
            </label>
            <label className="flex flex-col gap-1.5 border-border border-t p-3 sm:border-t-0">
              <span className="field-label">Domains</span>
              <input
                className="input"
                placeholder="acme.com"
                value={domains}
                onChange={(e) => setDomains(e.target.value)}
                onKeyDown={onEnterKey(add)}
                onPaste={(e) => handleDomainPaste(e, domains, setDomains, true)}
                disabled={suggesting}
              />
            </label>
          </div>
          <div className="flex flex-col gap-3 border-border border-t p-3 sm:flex-row sm:items-end">
            <label className="flex flex-1 flex-col gap-1.5">
              <span className="field-label">Aliases (optional)</span>
              <input
                className="input"
                placeholder="comma-separated alternate names"
                value={aliases}
                onChange={(e) => setAliases(e.target.value)}
                onKeyDown={onEnterKey(add)}
                maxLength={400}
                disabled={suggesting}
              />
            </label>
            <button
              type="button"
              className="btn-secondary h-9 px-4"
              onClick={add}
              disabled={suggesting}
            >
              add competitor
            </button>
          </div>
        </div>
      )}
    </StepCard>
  );
};
