import { type ReactNode, useCallback, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { DitherIcon } from '@/components/dither/DitherIcon';
import { DitherGradient } from '@/components/dither-kit/gradient';
import { AccountMenu } from '@/components/onboarding/AccountMenu';
import { BrandStep } from '@/components/onboarding/BrandStep';
import { CompetitorsStep } from '@/components/onboarding/CompetitorsStep';
import { DescribeStep } from '@/components/onboarding/DescribeStep';
import {
  type OnboardingBrandDraft,
  OnboardingContext,
} from '@/components/onboarding/OnboardingContext';
import { OnboardingReport } from '@/components/onboarding/OnboardingReport';
import {
  OnboardingDashboardReturn,
  OnboardingWorkspaceMenu,
} from '@/components/onboarding/OnboardingWorkspaceNav';
import { PromptsStep } from '@/components/onboarding/PromptsStep';
import { ReviewStep } from '@/components/onboarding/ReviewStep';
import { StepCard } from '@/components/onboarding/StepCard';
import { Stepper } from '@/components/onboarding/Stepper';
import type {
  StepNavigationHandler,
  StepNavigationRegistrar,
} from '@/components/onboarding/step-navigation';
import { BRANDED_THEME_TOKENS } from '@/lib/branded-theme';
import {
  type OnboardingFlow,
  STEP_TITLES,
  stepAt,
  stepIndex,
  useOnboardingFlow,
} from '@/lib/onboarding';
import { SIGN_IN_PATH } from '@/lib/routes';
import { useTheme } from '@/lib/theme';
import type { OnboardingState, OnboardingStep } from '@/lib/types';
import { useAuth } from '@/providers/auth';
import { useWorkspace } from '@/providers/workspace';

const OnboardingRail = ({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) => (
  <div
    className={`mx-auto w-full max-w-[1120px] border-border border-x ${className}`}
  >
    {children}
  </div>
);

const StepBody = ({
  flow,
  state,
  registerNavigation,
  onBrandDraftChange,
}: {
  flow: OnboardingFlow;
  state: OnboardingState;
  registerNavigation: StepNavigationRegistrar;
  onBrandDraftChange: (draft: OnboardingBrandDraft) => void;
}) => {
  switch (state.step) {
    case 'brand':
      return (
        <BrandStep
          flow={flow}
          state={state}
          registerNavigation={registerNavigation}
          onDraftChange={onBrandDraftChange}
        />
      );
    case 'describe':
      return (
        <DescribeStep
          flow={flow}
          state={state}
          registerNavigation={registerNavigation}
        />
      );
    case 'competitors':
      return (
        <CompetitorsStep
          flow={flow}
          state={state}
          registerNavigation={registerNavigation}
        />
      );
    case 'prompts':
      return (
        <PromptsStep
          flow={flow}
          state={state}
          registerNavigation={registerNavigation}
        />
      );
    case 'report':
      return (
        <ReviewStep
          flow={flow}
          state={state}
          registerNavigation={registerNavigation}
        />
      );
  }
};

const LoadingContext = () => (
  <aside className="border-border border-b px-5 py-10 sm:px-8 lg:border-r lg:border-b-0 lg:py-14">
    <p className="font-mono text-[10px] text-accent uppercase tracking-[0.16em]">
      workspace setup
    </p>
    <h2 className="mt-5 max-w-[380px] text-balance text-[28px] text-primary leading-[1.08] tracking-[-0.035em] sm:text-[32px]">
      Build your AI search monitoring system.
    </h2>
    <p className="mt-5 max-w-[380px] text-[14px] text-secondary leading-[1.7]">
      Your progress is saved after every step, so you can return without losing
      the work already completed.
    </p>
  </aside>
);

export const Onboarding = () => {
  const { current } = useWorkspace();
  const { email, logout } = useAuth();
  const navigate = useNavigate();
  const flow = useOnboardingFlow();
  const [theme, toggleTheme] = useTheme();
  const stepNavigationRef = useRef<{
    step: OnboardingStep;
    handler: StepNavigationHandler;
  } | null>(null);
  const [draftValidity, setDraftValidity] = useState<{
    step: OnboardingStep;
    valid: boolean;
  }>({ step: 'brand', valid: false });
  const [brandDraft, setBrandDraft] = useState<OnboardingBrandDraft | null>(
    null,
  );

  const registerStepNavigation = useCallback<StepNavigationRegistrar>(
    (step, handler, valid = true) => {
      if (handler) {
        stepNavigationRef.current = { step, handler };
        setDraftValidity((current) =>
          current.step === step && current.valid === valid
            ? current
            : { step, valid },
        );
        return;
      }
      if (stepNavigationRef.current?.step === step) {
        stepNavigationRef.current = null;
      }
    },
    [],
  );

  if (current?.onboardingCompleted) {
    return <Navigate to="/home" replace />;
  }

  const signOut = async () => {
    await logout();
    navigate(SIGN_IN_PATH, { replace: true });
  };

  if (flow.committed && flow.state) {
    return (
      <div
        className="onboarding-shell min-h-svh bg-bg text-primary"
        style={BRANDED_THEME_TOKENS[theme]}
      >
        <OnboardingReport flow={flow} state={flow.state} />
      </div>
    );
  }

  const activeStep = flow.state?.step ?? 'brand';
  const isStepValid = (step: OnboardingStep) => {
    if (draftValidity.step === step && activeStep === step) {
      return draftValidity.valid;
    }
    switch (step) {
      case 'brand':
        return Boolean(
          flow.state?.brand?.name && flow.state.brand.domains.length > 0,
        );
      case 'describe':
        return Boolean(flow.state?.brand);
      case 'competitors':
        return (flow.state?.profile.competitors.length ?? 0) > 0;
      case 'prompts':
        return (flow.state?.profile.prompts.length ?? 0) > 0;
      case 'report':
        return true;
    }
  };
  const canSelectStep = (target: OnboardingStep) => {
    const targetIndex = stepIndex(target);
    const activeIndex = stepIndex(activeStep);
    if (targetIndex < activeIndex) {
      return true;
    }
    for (let index = 0; index < targetIndex; index += 1) {
      if (!isStepValid(stepAt(index))) {
        return false;
      }
    }
    return true;
  };
  const navigateFromStepper = (target: OnboardingStep) => {
    const registered = stepNavigationRef.current;
    if (registered?.step === activeStep) {
      void registered.handler(target);
      return;
    }
    void flow.goTo(target);
  };

  return (
    <div
      className="onboarding-shell flex min-h-svh flex-col bg-bg text-primary lg:h-svh lg:overflow-hidden"
      style={BRANDED_THEME_TOKENS[theme]}
    >
      <header className="shrink-0 border-border border-b">
        <OnboardingRail>
          <div className="grid h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-3 sm:px-8 md:h-17 md:grid-cols-[1fr_auto_1fr]">
            <a
              href="/"
              className="flex items-center gap-2.5"
              aria-label="refd home"
            >
              <DitherIcon name="logo" size={20} className="text-primary" />
              <span className="hidden font-mono text-[15px] text-primary sm:inline">
                refd
              </span>
            </a>
            <div className="flex min-w-0 justify-center">
              <OnboardingWorkspaceMenu disabled={flow.loading || flow.busy} />
            </div>
            <div className="flex items-center justify-end gap-1.5">
              <OnboardingDashboardReturn disabled={flow.busy} />
              {email ? <AccountMenu email={email} onSignOut={signOut} /> : null}
            </div>
          </div>
        </OnboardingRail>
      </header>

      <div className="border-border border-b">
        <OnboardingRail>
          <Stepper
            current={activeStep}
            brandDomain={flow.state?.brand?.domains[0]}
            canSelect={canSelectStep}
            onSelect={navigateFromStepper}
            disabled={flow.loading || flow.busy}
          />
        </OnboardingRail>
      </div>

      <main className="flex flex-1 border-border border-b lg:min-h-0">
        <OnboardingRail className="flex-1 lg:min-h-0">
          <div className="grid min-h-full lg:h-full lg:min-h-0 lg:grid-cols-[0.8fr_1.2fr]">
            {flow.state ? (
              <OnboardingContext
                step={flow.state.step}
                state={flow.state}
                theme={theme}
                brandDraft={brandDraft ?? undefined}
              />
            ) : (
              <LoadingContext />
            )}

            {flow.loading ? (
              <StepCard step={activeStep} title={STEP_TITLES[activeStep]}>
                <p className="py-12 text-center font-mono text-[11px] text-muted uppercase tracking-[0.12em]">
                  loading workspace…
                </p>
              </StepCard>
            ) : flow.loadError ? (
              <StepCard step={activeStep} title={STEP_TITLES[activeStep]}>
                <p
                  role="alert"
                  className="border-error/40 border-l-2 bg-error/5 px-3 py-2 text-[12px] text-error"
                >
                  {flow.loadError}
                </p>
              </StepCard>
            ) : flow.state ? (
              <StepBody
                flow={flow}
                state={flow.state}
                registerNavigation={registerStepNavigation}
                onBrandDraftChange={setBrandDraft}
              />
            ) : null}
          </div>
        </OnboardingRail>
      </main>

      <footer className="border-border border-b">
        <OnboardingRail className="relative overflow-hidden">
          <DitherGradient
            from="red"
            to="transparent"
            direction="up"
            cell={3}
            opacity={theme === 'dark' ? 0.055 : 0.025}
            bloom="off"
          />
          <div className="relative z-1 flex min-h-16 items-center justify-between gap-4 px-5 sm:px-8">
            <span className="font-mono text-[10px] text-muted uppercase tracking-[0.12em]">
              progress saves automatically
            </span>
            <button
              type="button"
              onClick={toggleTheme}
              className="flex h-8 items-center gap-2 text-[11px] text-secondary transition-colors hover:text-primary"
            >
              <DitherIcon name={theme === 'dark' ? 'sun' : 'moon'} size={13} />
            </button>
          </div>
        </OnboardingRail>
      </footer>
    </div>
  );
};
