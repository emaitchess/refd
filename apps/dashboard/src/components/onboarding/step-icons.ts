import type { DitherIconName } from '@/components/dither/DitherIcon';
import type { OnboardingStep } from '@/lib/types';

// Steps that outlive onboarding carry their nav glyph, so the shape a user
// learns here is the one they'll click in the sidebar later. Shared by the
// stepper rail and each step's card title.
export const STEP_ICONS: Record<OnboardingStep, DitherIconName> = {
  brand: 'flag',
  describe: 'text',
  competitors: 'competitors',
  prompts: 'prompts',
  report: 'overview',
};
