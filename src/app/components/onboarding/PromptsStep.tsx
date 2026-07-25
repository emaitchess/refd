import {
  type KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
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
import type { PromptCategory } from '@/lib/prompt-categories';
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
  const [category, setCategory] = useState<PromptCategory>(
    PROMPT_CATEGORIES[0],
  );
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

  const [filter, setFilter] = useState<PromptCategory>(
    () =>
      PROMPT_CATEGORIES.find((promptCategory) =>
        state.profile.prompts.some(
          (prompt) => prompt.category === promptCategory,
        ),
      ) ?? PROMPT_CATEGORIES[0],
  );
  const tabsId = useId();
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const counts = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const p of list) {
      acc[p.category] = (acc[p.category] ?? 0) + 1;
    }
    return acc;
  }, [list]);
  const shown = list.filter((p) => p.category === filter);
  const tabPanelId = `${tabsId}-panel`;

  const onTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    current: PromptCategory,
  ) => {
    const currentIndex = PROMPT_CATEGORIES.indexOf(current);
    let nextIndex: number | null = null;
    if (event.key === 'ArrowLeft') {
      nextIndex =
        (currentIndex - 1 + PROMPT_CATEGORIES.length) %
        PROMPT_CATEGORIES.length;
    } else if (event.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % PROMPT_CATEGORIES.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = PROMPT_CATEGORIES.length - 1;
    }
    if (nextIndex === null) {
      return;
    }
    event.preventDefault();
    const next = PROMPT_CATEGORIES[nextIndex] ?? PROMPT_CATEGORIES[0];
    setFilter(next);
    tabRefs.current.get(next)?.focus();
  };

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
    setCategory(filter);
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
    setFilter(category);
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

      <div className="flex justify-end">
        <button
          type="button"
          className="btn-secondary h-7 px-4"
          onClick={openAdd}
          disabled={generating || adding}
        >
          + add prompt
        </button>
      </div>

      <div className="min-w-0 border border-border">
        <div className="min-w-0 border-border border-b bg-bg-elevated">
          <nav className="min-w-0" aria-label="Prompt categories">
            <div
              className="grid w-full grid-cols-5"
              role="tablist"
              aria-label="Prompt categories"
            >
              {PROMPT_CATEGORIES.map((promptCategory, index) => {
                const active = filter === promptCategory;
                const tabId = `${tabsId}-tab-${index}`;
                return (
                  <button
                    key={promptCategory}
                    ref={(node) => {
                      if (node) {
                        tabRefs.current.set(promptCategory, node);
                      } else {
                        tabRefs.current.delete(promptCategory);
                      }
                    }}
                    id={tabId}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    aria-controls={tabPanelId}
                    tabIndex={active ? 0 : -1}
                    onClick={() => setFilter(promptCategory)}
                    onKeyDown={(event) => onTabKeyDown(event, promptCategory)}
                    className={cn(
                      'relative flex h-10 min-w-0 items-center justify-center px-2 transition-colors',
                      'focus-visible:z-10 focus-visible:outline focus-visible:outline-border-strong',
                      index < PROMPT_CATEGORIES.length - 1 &&
                        'border-border border-r',
                      active
                        ? 'bg-accent-soft after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-primary'
                        : 'hover:bg-bg-card-hover',
                    )}
                  >
                    <PromptCategoryTag
                      category={promptCategory}
                      count={counts[promptCategory] ?? 0}
                      active={active}
                      size="md"
                      className="w-full justify-center border-0 bg-transparent"
                    />
                  </button>
                );
              })}
            </div>
          </nav>
        </div>
        <OnboardingScrollArea
          label="Scroll prompts"
          className="max-h-72"
          viewportClassName="max-h-72"
          scrollbarClassName="hidden [top:1px] [bottom:1px] sm:block"
        >
          <div
            id={tabPanelId}
            role="tabpanel"
            aria-labelledby={`${tabsId}-tab-${PROMPT_CATEGORIES.indexOf(filter)}`}
          >
            {shown.length > 0 ? (
              <ul className="flex flex-col divide-y divide-border">
                {shown.map((prompt) => (
                  <li
                    key={prompt.text}
                    className="group/prompt flex min-h-12 items-center justify-between gap-3 py-2 pr-5 pl-3"
                  >
                    <span className="min-w-0 text-[13px] text-primary leading-snug">
                      {prompt.text}
                    </span>
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
            ) : generating ? null : (
              <p className="px-3 py-5 text-center text-[12px] text-muted">
                No {filter.toLowerCase()} prompts yet. Add one to this category.
              </p>
            )}
          </div>
        </OnboardingScrollArea>
      </div>

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
              onChange={(value) => {
                const nextCategory = PROMPT_CATEGORIES.find(
                  (option) => option === value,
                );
                if (nextCategory) {
                  setCategory(nextCategory);
                }
              }}
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
