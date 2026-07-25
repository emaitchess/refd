import { useEffect, useRef } from 'react';
import type { OnboardingStep } from '@/lib/types';

export type StepNavigationHandler = (target: OnboardingStep) => unknown;

export type StepNavigationRegistrar = (
  step: OnboardingStep,
  handler: StepNavigationHandler | null,
  valid?: boolean,
) => void;

export const useStepNavigation = (
  register: StepNavigationRegistrar,
  step: OnboardingStep,
  handler: StepNavigationHandler,
  valid = true,
) => {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const navigate: StepNavigationHandler = (target) =>
      handlerRef.current(target);
    register(step, navigate, valid);
    return () => register(step, null);
  }, [register, step, valid]);
};
