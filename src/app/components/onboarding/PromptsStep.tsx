import { useEffect, useMemo, useRef, useState } from 'react';
import { Select } from '@/components/controls/Select';
import { SurfaceChips } from '@/components/controls/SurfaceChips';
import { DitherIcon } from '@/components/dither/DitherIcon';
import { useToast } from '@/components/feedback/Toast';
import { PromptCategoryTag } from '@/components/ui';
import { onEnterKey, useEnterAdvance, useEscapeBack } from '@/lib/keyboard';
import {
  canRegenerate,
  type OnboardingFlow,
  PROMPT_CATEGORIES,
  STEP_TITLES,
} from '@/lib/onboarding';
import type { OnboardingPrompt, OnboardingState } from '@/lib/types';
import { cn } from '@/lib/utils';
import { OnboardingScrollArea } from './OnboardingScrollArea';
import { RegenerateAction, StepCard } from './StepCard';
import { StepNav } from './StepNav';
import { STEP_ICONS } from './step-icons';
import {
  type StepNavigationRegistrar,
  useStepNavigation,
} from './step-navigation';

// Generation yields 25 (5 per category), leaving room to hand-add a few. The
// server caps the draft at the same number.
const MAX_PROMPTS = 30;

// Step 4: the buyer questions + the AI surfaces to check them on. Prompts are
// auto-generated on entry (glm-5.2), degrading to manual; surfaces default all-on.
export const PromptsStep = ({
  flow,
  state,
  registerNavigation,
}: {
  flow: OnboardingFlow;
  state: OnboardingState;
  registerNavigation: StepNavigationRegistrar;
}) => {
  const [list, setList] = useState<OnboardingPrompt[]>(state.profile.prompts);
  const [text, setText] = useState('');
  const [category, setCategory] = useState<string>(PROMPT_CATEGORIES[0]);
  const [adding, setAdding] = useState(false);
  const [generating, setGenerating] = useState(false);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const [note, setNote] = useState<{
    tone: 'ok' | 'warn';
    text: string;
  } | null>(null);
  const started = useRef(false);
  const hasBrand = Boolean(state.brand);
  const toast = useToast();

  // Category filter over the list (view-only). Falls back to "all" if the active
  // category empties out.
  const [filter, setFilter] = useState('all');
  const counts = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const p of list) {
      acc[p.category] = (acc[p.category] ?? 0) + 1;
    }
    return acc;
  }, [list]);
  const presentCategories = PROMPT_CATEGORIES.filter(
    (c) => (counts[c] ?? 0) > 0,
  );
  const activeFilter =
    filter !== 'all' && (counts[filter] ?? 0) === 0 ? 'all' : filter;
  const shown =
    activeFilter === 'all'
      ? list
      : list.filter((p) => p.category === activeFilter);

  const runGenerate = async (regenerate = false) => {
    setGenerating(true);
    setNote(null);
    const res = await flow.suggestPrompts(regenerate);
    setGenerating(false);
    if (!res) {
      setNote({
        tone: 'warn',
        text: "couldn't reach the generator, so add prompts below",
      });
      return;
    }
    if (res.ok) {
      setList(res.state.profile.prompts);
      setNote({
        tone: 'ok',
        text: 'generated a starter set: edit, remove, or add your own',
      });
      return;
    }
    setNote({
      tone: 'warn',
      text: "couldn't generate prompts, so add them below",
    });
  };

  useEffect(() => {
    if (adding) {
      draftRef.current?.focus();
    }
  }, [adding]);

  // Auto-generate once on entry when the list is empty.
  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;
    if (list.length === 0 && hasBrand) {
      void runGenerate();
    }
  }, [list.length, hasBrand]);

  const atCap = list.length >= MAX_PROMPTS;
  const capToast = () =>
    toast(
      `You can have up to ${MAX_PROMPTS} prompts during onboarding. Add more from the dashboard once you're set up.`,
    );

  // The draft form stays collapsed until asked for: generation covers the common
  // case, so a permanent textarea would spend the card's height on the exception.
  const openAdd = () => {
    if (atCap) {
      capToast();
      return;
    }
    setAdding(true);
  };

  const cancelAdd = () => {
    setAdding(false);
    setText('');
    flow.setError(null);
  };

  const add = () => {
    if (atCap) {
      capToast();
      return;
    }
    const t = text.trim();
    if (t.length < 8) {
      flow.setError('a prompt needs at least 8 characters');
      return;
    }
    if (list.some((p) => p.text.toLowerCase() === t.toLowerCase())) {
      flow.setError('that prompt is already in the list');
      return;
    }
    setList((prev) => [...prev, { text: t, category }]);
    setText('');
    setAdding(false);
    flow.setError(null);
  };

  const remove = (promptText: string) =>
    setList((prev) => prev.filter((p) => p.text !== promptText));

  const next = () => flow.patch({ prompts: list, step: 'report' });
  const back = () => flow.patch({ prompts: list, step: 'competitors' });
  useStepNavigation(
    registerNavigation,
    'prompts',
    (step) => flow.patch({ prompts: list, step }),
    list.length > 0,
  );
  useEnterAdvance(next, !flow.busy && !generating && list.length > 0);
  // Escape dismisses the draft form first; only a second one leaves the step.
  useEscapeBack(() => {
    if (adding) {
      cancelAdd();
      return;
    }
    back();
  }, !flow.busy && !generating);

  // One regeneration, then it's manual — the button stays live so the cap is
  // explained on click rather than silently greying out.
  const onRegenerate = () => {
    if (!canRegenerate(state, 'prompts')) {
      toast('You can regenerate the prompt set once. Edit the list below.');
      return;
    }
    void runGenerate(true);
  };

  return (
    <StepCard
      step="prompts"
      title={STEP_TITLES.prompts}
      icon={STEP_ICONS.prompts}
      error={flow.error}
      action={
        hasBrand ? (
          <RegenerateAction
            loading={generating}
            loadingLabel="generating"
            label="regenerate"
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
          nextDisabled={generating || list.length === 0}
        />
      }
    >
      <div className="flex flex-col gap-2">
        <span className="field-label">AI surfaces to track</span>
        <SurfaceChips
          selected={state.surfaces}
          onChange={flow.setSurfaces}
          disabled={generating}
        />
      </div>

      <p className="max-w-[590px] text-[14px] text-secondary leading-[1.7]">
        Each run checks every prompt across the surfaces above. Start with the
        questions buyers ask as they discover, compare, and choose products.
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

      <div className="flex min-w-0 items-start gap-2">
        <nav
          className="prompt-category-scroll min-w-0 flex-1 overflow-x-auto overscroll-x-contain pb-1"
          aria-label="Prompt category filters"
        >
          <div className="flex w-max gap-1.5">
            {['all', ...presentCategories].map((f) => {
              const active = activeFilter === f;
              const count = f === 'all' ? list.length : (counts[f] ?? 0);
              return (
                <button
                  key={f}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFilter(f)}
                  className={cn(
                    'shrink-0 transition-colors focus-visible:outline focus-visible:outline-border-strong',
                    f === 'all' &&
                      'flex h-7 items-center gap-1.5 border px-2 font-mono text-[11px]',
                    f === 'all' &&
                      (active
                        ? 'border-border-strong bg-accent-soft text-primary'
                        : 'border-border text-muted hover:text-secondary'),
                  )}
                >
                  {f === 'all' ? (
                    <>
                      All
                      <span
                        className={active ? 'text-secondary' : 'text-muted'}
                      >
                        {count}
                      </span>
                    </>
                  ) : (
                    <PromptCategoryTag
                      category={f}
                      count={count}
                      active={active}
                      size="md"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </nav>
        <button
          type="button"
          className="btn-secondary h-7 shrink-0 px-4"
          onClick={openAdd}
          disabled={generating || adding}
        >
          + add prompt
        </button>
      </div>

      {list.length > 0 ? (
        <OnboardingScrollArea
          label="Scroll prompts"
          className="max-h-72"
          viewportClassName="max-h-72 border border-border"
          scrollbarClassName="hidden [top:1px] [bottom:1px] sm:block"
        >
          <ul className="flex flex-col divide-y divide-border">
            {shown.map((prompt) => (
              <li
                key={prompt.text}
                className="group/prompt flex items-start justify-between gap-3 py-2 pr-5 pl-3"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <PromptCategoryTag
                    category={prompt.category}
                    className="self-start"
                  />
                  <span className="text-[13px] text-primary leading-snug">
                    {prompt.text}
                  </span>
                </div>
                <button
                  type="button"
                  aria-label={`Remove prompt: ${prompt.text}`}
                  className="btn-ghost h-7 shrink-0 px-2 text-muted opacity-0 pointer-coarse:opacity-100 transition-[opacity,color] duration-150 hover:text-error focus-visible:opacity-100 group-hover/prompt:opacity-100"
                  onClick={() => remove(prompt.text)}
                >
                  <DitherIcon name="trash" size={14} />
                </button>
              </li>
            ))}
          </ul>
        </OnboardingScrollArea>
      ) : generating ? null : (
        <p className="border border-border border-dashed px-3 py-4 text-center text-[12px] text-muted">
          No prompts yet. Add a few to begin monitoring.
        </p>
      )}

      {adding ? (
        <div className="flex flex-col gap-3 border border-border p-3">
          <label className="flex flex-col gap-1.5">
            <span className="field-label">Prompt</span>
            <textarea
              ref={draftRef}
              className="input min-h-20 resize-y py-2"
              placeholder="e.g. What are the best AI search monitoring tools?"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onEnterKey(add)}
              maxLength={500}
              disabled={generating}
            />
          </label>
          <span className="field-label">Buyer journey category</span>
          <div className="flex flex-wrap gap-2 sm:flex-nowrap">
            <Select
              value={category}
              options={PROMPT_CATEGORIES}
              onChange={setCategory}
              disabled={generating}
              ariaLabel="Prompt category"
              openUp
              className="flex-1"
              renderOption={(option) => <PromptCategoryTag category={option} />}
            />
            <button
              type="button"
              className="btn-ghost h-9 px-3"
              onClick={cancelAdd}
              disabled={generating}
            >
              cancel
            </button>
            <button
              type="button"
              className="btn-secondary h-9 px-4"
              onClick={add}
              disabled={generating}
            >
              add
            </button>
          </div>
        </div>
      ) : null}
    </StepCard>
  );
};
