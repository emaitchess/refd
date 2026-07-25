import type { ReactNode } from 'react';
import { Tooltip } from '@/components/dither-kit/tooltip';
import { SurfaceLogo } from '@/components/svgs/SurfaceLogo';
import { Favicon } from '@/components/ui';
import { surfaceLabel } from '@/lib/format';
import { useEnterAdvance, useEscapeBack } from '@/lib/keyboard';
import { type OnboardingFlow, STEP_TITLES } from '@/lib/onboarding';
import type { OnboardingState } from '@/lib/types';
import { cn } from '@/lib/utils';
import { StepCard } from './StepCard';
import { StepNav } from './StepNav';
import { STEP_ICONS } from './step-icons';
import {
  type StepNavigationRegistrar,
  useStepNavigation,
} from './step-navigation';

const Row = ({ label, value }: { label: string; value: ReactNode }) => (
  <div className="flex items-start justify-between gap-3 py-2">
    <span className="section-label shrink-0 pt-0.5 text-muted">{label}</span>
    <span className="wrap-break-word min-w-0 text-right text-[13px] text-primary">
      {value}
    </span>
  </div>
);

const CompetitorStack = ({
  competitors,
}: {
  competitors: OnboardingState['profile']['competitors'];
}) => {
  if (competitors.length === 0) {
    return '—';
  }

  const remaining = Math.max(0, competitors.length - 3);

  return (
    <div
      role="img"
      aria-label={`Competitors: ${competitors.map((competitor) => competitor.name).join(', ')}`}
      className="group/competitors flex max-w-[min(430px,60vw)] justify-end overflow-x-auto py-1"
    >
      <div className="flex items-center justify-end gap-1">
        {competitors.map((competitor, index) => (
          <Tooltip
            key={`${competitor.name}-${competitor.domains[0] ?? index}`}
            asChild
            content={competitor.name}
            className="border-border-strong bg-bg-elevated text-primary shadow-lg"
          >
            <span
              className={cn(
                'h-7 w-7 shrink-0 items-center justify-center overflow-hidden border border-border-strong bg-bg-elevated',
                index < 3 ? 'flex' : 'hidden group-hover/competitors:flex',
              )}
            >
              <Favicon domain={competitor.domains[0] ?? ''} size={16} />
            </span>
          </Tooltip>
        ))}
        {remaining > 0 ? (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden border border-border-strong bg-accent-soft font-mono text-[10px] text-primary group-hover/competitors:hidden">
            +{remaining}
          </span>
        ) : null}
      </div>
    </div>
  );
};

const AISurfaceStack = ({ surfaces }: { surfaces: string[] }) => {
  if (surfaces.length === 0) {
    return '—';
  }

  const remaining = Math.max(0, surfaces.length - 3);

  return (
    <div
      role="img"
      aria-label={`AI surfaces: ${surfaces.map(surfaceLabel).join(', ')}`}
      className="group/surfaces flex max-w-[min(430px,60vw)] justify-end overflow-x-auto py-1"
    >
      <div className="flex items-center justify-end gap-1">
        {surfaces.map((surface, index) => (
          <Tooltip
            key={surface}
            asChild
            content={surfaceLabel(surface)}
            className="border-border-strong bg-bg-elevated text-primary shadow-lg"
          >
            <span
              className={cn(
                'h-7 w-7 shrink-0 items-center justify-center overflow-hidden border border-border-strong bg-bg-elevated',
                index < 3 ? 'flex' : 'hidden group-hover/surfaces:flex',
              )}
            >
              <SurfaceLogo surface={surface} className="size-4" />
            </span>
          </Tooltip>
        ))}
        {remaining > 0 ? (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden border border-border-strong bg-accent-soft font-mono text-[10px] text-primary group-hover/surfaces:hidden">
            +{remaining}
          </span>
        ) : null}
      </div>
    </div>
  );
};

// Step 5: confirm and start. Commit fires the preliminary run and drops into the
// live report.
export const ReviewStep = ({
  flow,
  state,
  registerNavigation,
}: {
  flow: OnboardingFlow;
  state: OnboardingState;
  registerNavigation: StepNavigationRegistrar;
}) => {
  const { brand, profile } = state;
  const back = () => flow.goTo('prompts');
  useStepNavigation(registerNavigation, 'report', flow.goTo);
  useEnterAdvance(flow.commit, !flow.busy);
  useEscapeBack(back, !flow.busy);

  return (
    <StepCard
      step="report"
      title={STEP_TITLES.report}
      icon={STEP_ICONS.report}
      error={flow.error}
      footer={
        <StepNav
          onBack={back}
          onNext={flow.commit}
          nextLabel="start monitoring"
          busy={flow.busy}
          final
        />
      }
    >
      {profile.description ? (
        <p className="text-[14px] text-secondary leading-[1.7]">
          {profile.description}
        </p>
      ) : null}
      <div className="divide-y divide-border border border-border px-3">
        <Row label="Domains" value={brand?.domains.join(', ') || '—'} />
        <Row
          label="Competitors"
          value={<CompetitorStack competitors={profile.competitors} />}
        />
        <Row label="Prompts" value={String(profile.prompts.length)} />
        <Row
          label="AI surfaces"
          value={<AISurfaceStack surfaces={state.surfaces} />}
        />
      </div>
      <p className="text-[12px] text-muted leading-[1.65]">
        We'll run your first check now (one prompt per category across your
        selected surfaces) and show your preliminary AI Visibility Report. The
        rest run in the background.
      </p>
    </StepCard>
  );
};
