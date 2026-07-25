import { useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/feedback/Toast';
import { onEnterKey, useEnterAdvance, useEscapeBack } from '@/lib/keyboard';
import {
  canRegenerate,
  type OnboardingFlow,
  STEP_TITLES,
} from '@/lib/onboarding';
import type { OnboardingState } from '@/lib/types';
import { cn } from '@/lib/utils';
import { RegenerateAction, StepCard } from './StepCard';
import { StepNav } from './StepNav';
import { STEP_ICONS } from './step-icons';
import {
  type StepNavigationRegistrar,
  useStepNavigation,
} from './step-navigation';

const SOURCE_LABEL: Record<string, string> = {
  'llms.txt': "your site's llms.txt",
  'llms-full.txt': "your site's llms-full.txt",
  rendered: 'your homepage',
};

// Step 2: a public-facing description. On entry we auto-draft it from the brand's
// site via Browser Rendering + glm-5.2; every failure degrades to manual entry.
export const DescribeStep = ({
  flow,
  state,
  registerNavigation,
}: {
  flow: OnboardingFlow;
  state: OnboardingState;
  registerNavigation: StepNavigationRegistrar;
}) => {
  const [description, setDescription] = useState(state.profile.description);
  const [targetMarket, setTargetMarket] = useState(state.profile.targetMarket);
  const [extracting, setExtracting] = useState(false);
  const [note, setNote] = useState<{
    tone: 'ok' | 'warn';
    text: string;
  } | null>(null);
  const started = useRef(false);
  const domain = state.brand?.domains[0];
  const toast = useToast();

  const runExtract = async (regenerate = false) => {
    setExtracting(true);
    setNote(null);
    const res = await flow.extract(regenerate);
    setExtracting(false);
    if (!res) {
      setNote({
        tone: 'warn',
        text: "couldn't reach the drafting service, so write a description below",
      });
      return;
    }
    if (res.ok) {
      setDescription(res.state.profile.description);
      setTargetMarket(res.state.profile.targetMarket);
      setNote({
        tone: 'ok',
        text: `drafted from ${SOURCE_LABEL[res.source ?? ''] ?? 'your site'} (edit as needed)`,
      });
      return;
    }
    setNote({
      tone: 'warn',
      text:
        res.reason === 'llm'
          ? "read your site but couldn't draft a description, so write one below"
          : "couldn't read your site automatically, so write a description below",
    });
  };

  // Auto-draft once on entry, only when nothing is written yet and we have a domain.
  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;
    if (!description && domain) {
      void runExtract();
    }
  }, [description, domain]);

  // Both directions save the draft, so leaving the step never loses edits.
  const go = (step: 'brand' | 'competitors') => () =>
    flow.patch({
      description: description.trim(),
      targetMarket: targetMarket.trim(),
      step,
    });
  const next = go('competitors');
  const back = go('brand');
  useStepNavigation(registerNavigation, 'describe', (step) =>
    flow.patch({
      description: description.trim(),
      targetMarket: targetMarket.trim(),
      step,
    }),
  );

  useEnterAdvance(next, !flow.busy && !extracting);
  useEscapeBack(back, !flow.busy && !extracting);

  // One redraft, then it's manual — the button stays live so the cap is
  // explained on click rather than silently greying out.
  const onRegenerate = () => {
    if (!canRegenerate(state, 'describe')) {
      toast('You can redraft the description once. Edit it below instead.');
      return;
    }
    void runExtract(true);
  };

  return (
    <StepCard
      step="describe"
      title={STEP_TITLES.describe}
      icon={STEP_ICONS.describe}
      error={flow.error}
      action={
        domain ? (
          <RegenerateAction
            loading={extracting}
            loadingLabel="drafting"
            label="redraft"
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
          nextDisabled={extracting}
        />
      }
    >
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

      <label className="flex flex-col gap-1.5">
        <span className="field-label">Description</span>
        <textarea
          className="input min-h-32 resize-none py-2"
          disabled={extracting}
          maxLength={800}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="One or two sentences on what your brand does and who it's for."
          value={description}
        />
        <span className="text-[12px] text-muted leading-[1.55]">
          This remains editable. It is used to draft competitors and prompts.
        </span>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="field-label">Target market (optional)</span>
        <input
          className="input"
          placeholder="e.g. B2B marketing teams, indie developers"
          value={targetMarket}
          onChange={(e) => setTargetMarket(e.target.value)}
          onKeyDown={onEnterKey(next)}
          maxLength={200}
          disabled={extracting}
        />
      </label>
    </StepCard>
  );
};
