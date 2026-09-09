import { useParams } from 'react-router';
import { OnboardingReport } from '@/components/onboarding/OnboardingReport';
import { useOnboardingFlow } from '@/lib/onboarding';
import { useWorkspace } from '@/providers/workspace';

// The dedicated setup-report URL an agent hands back: renders the pinned
// report live, before or after onboarding completes.
export const SetupReportPage = () => {
  const params = useParams();
  const { current } = useWorkspace();
  const flow = useOnboardingFlow();
  const setupId = Number.parseInt(params.setupId ?? '', 10);
  if (!current || !flow.state || !Number.isFinite(setupId)) {
    return null;
  }
  return <OnboardingReport flow={{ ...flow, setupId }} state={flow.state} />;
};
