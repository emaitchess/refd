import { LandingContainer, SectionLabel } from './chrome';

export const PremiseSection = () => (
  <section className="border-border border-b">
    <LandingContainer className="grid lg:grid-cols-[0.85fr_2.15fr]">
      <div className="border-border px-5 py-12 sm:px-8 sm:py-16 lg:border-r lg:pr-12">
        <SectionLabel>the premise</SectionLabel>
        <p className="mt-4 max-w-[430px] text-[14px] text-secondary leading-[1.7]">
          Your buyers are asking AI what to buy. The brands it names, ranks, and
          cites are the brands that enter the conversation.
        </p>
      </div>
      <div className="px-5 py-12 sm:px-8 sm:py-16 lg:pl-14">
        <h2 className="max-w-[650px] text-[30px] leading-[1.12] tracking-[-0.035em] sm:text-[40px]">
          Know where you are visible, where you are missing, and who is{' '}
          <span className="font-medium font-sans text-accent">
            winning instead.
          </span>
        </h2>
        <p className="mt-5 max-w-[620px] text-[15px] text-secondary leading-[1.7]">
          refd tracks your presence across the AI platforms buyers use to
          discover brands. Every trend, comparison, and score is backed by the
          answer that produced it.
        </p>
      </div>
    </LandingContainer>
  </section>
);
