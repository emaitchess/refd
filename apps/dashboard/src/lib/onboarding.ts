import { SURFACES } from '@refd/core/surfaces';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useWorkspace } from '../providers/workspace';
import { api } from './api';
import {
  PROMPT_CATEGORIES,
  PROMPT_CATEGORY_EXPLAINERS,
} from './prompt-categories';
import type { OnboardingState, OnboardingStep } from './types';

export { PROMPT_CATEGORIES, PROMPT_CATEGORY_EXPLAINERS };

export const ALL_SURFACES = SURFACES;

const ORDER: OnboardingStep[] = [
  'brand',
  'describe',
  'competitors',
  'prompts',
  'report',
];
export const STEP_LABELS: Record<OnboardingStep, string> = {
  brand: 'Brand',
  describe: 'Describe',
  competitors: 'Competitors',
  prompts: 'Prompts',
  report: 'Review',
};
export const STEP_TITLES: Record<OnboardingStep, string> = {
  brand: 'Which brand are you monitoring?',
  describe: 'How should AI search understand your brand?',
  competitors: 'Who should you be compared with?',
  prompts: 'Which questions should refd monitor?',
  report: 'Ready to start monitoring?',
};
// Manual regenerate is capped per AI step — each one spends a model call. The
// server owns the count (a reload must not reset it); this is the matching
// client-side check, used to warn instead of firing a doomed request.
export type RegenKey = keyof OnboardingState['regen'];
export const canRegenerate = (state: OnboardingState, key: RegenKey): boolean =>
  state.regen[key] < state.regenLimit;

export const stepIndex = (step: OnboardingStep): number => ORDER.indexOf(step);
export const stepAt = (index: number): OnboardingStep =>
  ORDER[Math.max(0, Math.min(ORDER.length - 1, index))] ?? 'brand';
export const ONBOARDING_STEPS = ORDER;

// Owns the wizard's server state + mutations. Every mutation returns the fresh
// state so the shell stays in sync and the flow resumes on reload.
export const useOnboardingFlow = () => {
  const navigate = useNavigate();
  const { current, markBranded, markOnboarded } = useWorkspace();
  const [state, setState] = useState<OnboardingState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justCommitted, setJustCommitted] = useState(false);

  useEffect(() => {
    if (!current) {
      setState(null);
      setLoading(false);
      return;
    }
    let alive = true;
    setState(null);
    setLoading(true);
    setLoadError(null);
    setError(null);
    setJustCommitted(false);
    api<OnboardingState>('/onboarding')
      .then((s) => alive && setState(s))
      .catch(
        (e) =>
          alive &&
          setLoadError(e instanceof Error ? e.message : 'failed to load'),
      )
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [current?.id]);

  const call = useCallback(
    async <T>(fn: () => Promise<T>): Promise<T | null> => {
      setBusy(true);
      setError(null);
      try {
        return await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'something went wrong');
        return null;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const saveBrand = useCallback(
    (name: string, domains: string[], aliases: string[]) =>
      call(async () => {
        const next = await api<OnboardingState>('/onboarding/brand', {
          method: 'POST',
          body: JSON.stringify({ name, domains, aliases }),
        });
        setState(next);
        if (current) {
          markBranded(current.id);
        }
        return next;
      }),
    [call, current, markBranded],
  );

  // Persist a subset of the draft; pass `step` to advance/retreat at the same time.
  const patch = useCallback(
    (body: Record<string, unknown>) =>
      call(async () => {
        const next = await api<OnboardingState>('/onboarding', {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        setState(next);
        return next;
      }),
    [call],
  );

  const goTo = useCallback((step: OnboardingStep) => patch({ step }), [patch]);

  // Enabled surfaces are a workspace setting (not an onboarding draft). Persist
  // optimistically — a lost toggle is harmless since the default is all-on.
  const setSurfaces = useCallback((surfaces: string[]) => {
    setState((s) => (s ? { ...s, surfaces } : s));
    void api('/settings', {
      method: 'PATCH',
      body: JSON.stringify({ surfaces }),
    }).catch(() => {});
  }, []);

  // The AI steps each draft once on entry (regenerate: false); a manual
  // regenerate spends the step's single allowance, which the server counts.
  const aiStep = useCallback(
    (path: string, regenerate: boolean) =>
      call(async () => {
        const res = await api<ExtractResult>(`/onboarding/${path}`, {
          method: 'POST',
          body: JSON.stringify({ regenerate }),
        });
        setState(res.state);
        return res;
      }),
    [call],
  );

  // Fetch the site + draft the description via glm-5.2. Soft-fails (ok:false)
  // rather than throwing so the describe step can fall back to manual entry.
  const extract = useCallback(
    (regenerate = false) => aiStep('extract', regenerate),
    [aiStep],
  );

  // Discover competitors (parallel.ai + glm-5.2); same soft-fail shape as extract.
  const suggestCompetitors = useCallback(
    (regenerate = false) => aiStep('competitors', regenerate),
    [aiStep],
  );

  // Generate the buyer-question set (glm-5.2); same soft-fail shape.
  const suggestPrompts = useCallback(
    (regenerate = false) => aiStep('prompts', regenerate),
    [aiStep],
  );

  // Server-backed so a reload on the report resumes there rather than dropping
  // back to Review, which would commit (and spend a run) a second time.
  const committed = justCommitted || (state?.committed ?? false);

  // Materialise the workspace + fire the preliminary run. Stay on the report
  // view (don't navigate) until the user chooses to enter the dashboard.
  const commit = useCallback(
    () =>
      call(async () => {
        await api('/onboarding/commit', { method: 'POST', body: '{}' });
        setJustCommitted(true);
        return true;
      }),
    [call],
  );

  // Leaving the report is what finishes onboarding — the flag flips here, not at
  // commit, so an abandoned report is resumable.
  const enterDashboard = useCallback(
    () =>
      call(async () => {
        await api('/onboarding/complete', { method: 'POST', body: '{}' });
        if (current) {
          markOnboarded(current.id);
        }
        navigate('/home', { replace: true });
        return true;
      }),
    [call, current, markOnboarded, navigate],
  );

  return {
    state,
    loading,
    loadError,
    busy,
    error,
    setError,
    saveBrand,
    patch,
    goTo,
    setSurfaces,
    extract,
    suggestCompetitors,
    suggestPrompts,
    committed,
    commit,
    enterDashboard,
  };
};

export interface ExtractResult {
  ok: boolean;
  source?: string;
  reason?: string;
  state: OnboardingState;
}

export type OnboardingFlow = ReturnType<typeof useOnboardingFlow>;
