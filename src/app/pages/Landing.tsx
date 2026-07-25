import { BRANDED_THEME_TOKENS } from '@/lib/branded-theme';
import { useTheme } from '@/lib/theme';
import { ClosingSection } from './landing/ClosingSection';
import { Footer } from './landing/Footer';
import { Hero } from './landing/Hero';
import { HowItWorksSection } from './landing/HowItWorksSection';
import { OpenSourceSection } from './landing/OpenSourceSection';
import { PlatformSection } from './landing/PlatformSection';
import { PremiseSection } from './landing/PremiseSection';
import { SignalsSection } from './landing/SignalsSection';
import { SmoothScroll } from './landing/SmoothScroll';

export const Landing = () => {
  const [theme] = useTheme();

  return (
    <SmoothScroll>
      <div
        className="landing-shell min-h-screen overflow-hidden bg-bg text-primary"
        style={BRANDED_THEME_TOKENS[theme]}
      >
        <Hero />
        <main>
          <PremiseSection />
          <PlatformSection />
          <SignalsSection />
          <HowItWorksSection />
          <OpenSourceSection />
          <ClosingSection />
        </main>
        <Footer />
      </div>
    </SmoothScroll>
  );
};
