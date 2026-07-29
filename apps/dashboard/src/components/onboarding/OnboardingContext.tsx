import { DitherIcon } from '@/components/dither/DitherIcon';
import { DitherGradient } from '@/components/dither-kit/gradient';
import { SurfaceLogo } from '@/components/svgs/SurfaceLogo';
import { PromptCategoryTag } from '@/components/ui';
import { surfaceLabel } from '@/lib/format';
import {
  ALL_SURFACES,
  PROMPT_CATEGORIES,
  PROMPT_CATEGORY_EXPLAINERS,
  STEP_LABELS,
  stepIndex,
} from '@/lib/onboarding';
import type { OnboardingState, OnboardingStep } from '@/lib/types';
import { BrandMark } from './BrandMark';
import { STEP_ICONS } from './step-icons';

export interface OnboardingBrandDraft {
  name: string;
  domain?: string;
}

const CONTEXT: Record<
  OnboardingStep,
  { title: string; copy: string; meta: string }
> = {
  brand: {
    title: 'Start with the brand buyers should find.',
    copy: 'Your brand and domains become the reference point for every mention, citation, and position we measure.',
    meta: 'identity record',
  },
  describe: {
    title: 'Add the context behind the name.',
    copy: 'A clear profile helps refd draft relevant competitors and the questions buyers actually ask.',
    meta: 'brand profile',
  },
  competitors: {
    title: 'Define who earns the answer when you do not.',
    copy: 'Competitors turn visibility into a benchmark. Their order also fixes the color mapping used across your workspace.',
    meta: 'comparison set',
  },
  prompts: {
    title: 'Track questions that shape buying decisions.',
    copy: 'Prompts are the unit of monitoring. Every metric stays connected to the exact question and raw answer behind it.',
    meta: 'monitoring set',
  },
  report: {
    title: 'Review the system before the first answers arrive.',
    copy: 'We will check a representative set now, then finish the rest in the background and monitor it daily.',
    meta: 'ready check',
  },
};

const IllustrationHeader = ({
  label,
  value,
}: {
  label: string;
  value: string;
}) => (
  <div className="flex items-center justify-between gap-3 border-border border-b px-4 py-3">
    <span className="font-mono text-[10px] text-muted uppercase tracking-[0.14em]">
      {label}
    </span>
    <span className="font-mono text-[10px] text-accent uppercase tracking-[0.12em]">
      {value}
    </span>
  </div>
);

const BrandIllustration = ({
  state,
  draft,
}: {
  state: OnboardingState;
  draft?: OnboardingBrandDraft;
}) => (
  <>
    <IllustrationHeader label="monitored surfaces" value="05 connected" />
    <div className="grid grid-cols-5 divide-x divide-border border-border border-b">
      {ALL_SURFACES.map((surface) => (
        <div
          key={surface}
          className="flex h-14 items-center justify-center text-secondary"
        >
          <SurfaceLogo surface={surface} className="size-4" />
          <span className="sr-only">{surfaceLabel(surface)}</span>
        </div>
      ))}
    </div>
    <div className="p-4">
      <BrandMark
        name={draft ? draft.name : (state.brand?.name ?? 'your brand')}
        domain={draft ? draft.domain : state.brand?.domains[0]}
      />
    </div>
  </>
);

const DescribeIllustration = ({ state }: { state: OnboardingState }) => (
  <>
    <IllustrationHeader label="profile draft" value="editable" />
    <div className="grid grid-cols-[88px_1fr] border-border border-b">
      <span className="border-border border-r px-4 py-3 font-mono text-[10px] text-muted uppercase">
        source
      </span>
      <span className="truncate px-4 py-3 font-mono text-[11px] text-primary">
        {state.brand?.domains[0] ?? 'your website'}
      </span>
    </div>
    <div className="divide-y divide-border px-4">
      {[
        ['01', 'what your brand does'],
        ['02', 'who it serves'],
        ['03', 'where it competes'],
      ].map(([number, label]) => (
        <div key={number} className="flex items-center gap-3 py-3">
          <span className="font-mono text-[10px] text-accent">{number}</span>
          <span className="text-[12px] text-secondary">{label}</span>
        </div>
      ))}
    </div>
  </>
);

const CompetitorsIllustration = ({ state }: { state: OnboardingState }) => {
  const names = [
    state.brand?.name ?? 'your brand',
    ...state.profile.competitors.map((competitor) => competitor.name),
  ].slice(0, 4);
  return (
    <>
      <IllustrationHeader
        label="comparison set"
        value={`${Math.max(0, names.length - 1)} competitors`}
      />
      <div className="divide-y divide-border">
        {names.map((name, index) => (
          <div
            key={`${name}-${index}`}
            className="grid grid-cols-[52px_1fr_auto] items-center px-4 py-3"
          >
            <span className="font-mono text-[10px] text-muted">
              {String(index + 1).padStart(2, '0')}
            </span>
            <span className="truncate text-[12px] text-primary">{name}</span>
            <span className="font-mono text-[10px] text-muted">
              {index === 0 ? 'reference' : 'tracked'}
            </span>
          </div>
        ))}
        {names.length < 2 ? (
          <div className="px-4 py-6 text-center font-mono text-[10px] text-muted uppercase tracking-[0.12em]">
            discovery pending
          </div>
        ) : null}
      </div>
    </>
  );
};

const PromptsIllustration = ({ state }: { state: OnboardingState }) => {
  return (
    <>
      <IllustrationHeader
        label="buyer journey"
        value={`${state.profile.prompts.length || '00'} prompts`}
      />
      <div className="divide-y divide-border">
        {PROMPT_CATEGORIES.map((category, index) => (
          <div
            key={category}
            className="grid grid-cols-[28px_104px_1fr] items-center gap-2 px-4 py-3"
          >
            <span className="font-mono text-[10px] text-accent">
              {String(index + 1).padStart(2, '0')}
            </span>
            <PromptCategoryTag category={category} />
            <span className="text-[10px] text-muted leading-[1.4]">
              {PROMPT_CATEGORY_EXPLAINERS[category]}
            </span>
          </div>
        ))}
      </div>
    </>
  );
};

const ReviewIllustration = ({ state }: { state: OnboardingState }) => (
  <>
    <IllustrationHeader label="monitoring system" value="ready" />
    <div className="grid grid-cols-3 divide-x divide-border border-border border-b">
      {[
        [String(state.profile.competitors.length), 'competitors'],
        [String(state.profile.prompts.length), 'prompts'],
        [String(state.surfaces.length), 'surfaces'],
      ].map(([value, label]) => (
        <div key={label} className="px-3 py-5 text-center">
          <p className="font-mono text-[20px] text-primary">{value}</p>
          <p className="mt-1 font-mono text-[9px] text-muted uppercase tracking-[0.1em]">
            {label}
          </p>
        </div>
      ))}
    </div>
    <div className="flex items-center gap-3 px-4 py-4">
      <DitherIcon name="overview" size={18} className="text-accent" />
      <div>
        <p className="text-[12px] text-primary">First visibility report</p>
        <p className="mt-0.5 font-mono text-[10px] text-muted">
          starts after confirmation
        </p>
      </div>
    </div>
  </>
);

const StepIllustration = ({
  step,
  state,
  brandDraft,
}: {
  step: OnboardingStep;
  state: OnboardingState;
  brandDraft?: OnboardingBrandDraft;
}) => {
  switch (step) {
    case 'brand':
      return <BrandIllustration state={state} draft={brandDraft} />;
    case 'describe':
      return <DescribeIllustration state={state} />;
    case 'competitors':
      return <CompetitorsIllustration state={state} />;
    case 'prompts':
      return <PromptsIllustration state={state} />;
    case 'report':
      return <ReviewIllustration state={state} />;
  }
};

export const OnboardingContext = ({
  step,
  state,
  theme,
  brandDraft,
}: {
  step: OnboardingStep;
  state: OnboardingState;
  theme: 'dark' | 'light';
  brandDraft?: OnboardingBrandDraft;
}) => {
  const content = CONTEXT[step];
  return (
    <aside className="relative flex min-w-0 flex-col overflow-hidden border-border border-b px-5 py-9 sm:px-8 sm:py-11 lg:border-r lg:border-b-0 lg:py-14">
      <DitherGradient
        from="red"
        to="transparent"
        direction="up"
        cell={3}
        opacity={theme === 'dark' ? 0.075 : 0.035}
        bloom="off"
        className="top-auto h-[58%]"
      />
      <div className="relative z-1">
        <div className="flex items-center gap-2.5 font-mono text-[10px] text-accent uppercase tracking-[0.16em]">
          <DitherIcon name={STEP_ICONS[step]} size={14} />
          <span>{content.meta}</span>
        </div>
        <h2 className="mt-5 max-w-[390px] text-balance font-[450] text-[27px] text-primary leading-[1.08] tracking-[-0.035em] sm:text-[32px]">
          {content.title}
        </h2>
        <p className="mt-5 max-w-[390px] text-[14px] text-secondary leading-[1.7]">
          {content.copy}
        </p>
      </div>

      <div className="relative z-1 mt-8 hidden overflow-hidden border border-border bg-bg/70 shadow-[0_18px_55px_var(--color-shadow)] sm:block lg:mt-auto">
        <StepIllustration step={step} state={state} brandDraft={brandDraft} />
      </div>

      <p className="relative z-1 mt-7 font-mono text-[10px] text-muted uppercase tracking-[0.12em] sm:hidden">
        {String(stepIndex(step) + 1).padStart(2, '0')} / 05 ·{' '}
        {STEP_LABELS[step]}
      </p>
    </aside>
  );
};
