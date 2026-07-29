import { DitherButton } from '@/components/dither-kit/button';
import { SIGN_IN_URL } from '../../consts';
import {
  LandingContainer,
  LandingInset,
  SectionLabel,
  useAccountCta,
} from './chrome';

export const ClosingSection = () => {
  const { authed, to } = useAccountCta();

  return (
    <section className="border-border border-b text-center">
      <LandingContainer>
        <LandingInset className="py-16 sm:py-24">
          <SectionLabel>your next answer starts here</SectionLabel>
          <h2 className="mx-auto mt-5 max-w-[760px] font-[450] font-sans text-[38px] leading-[1.08] tracking-[-0.035em] sm:text-[58px]">
            See where your brand appears next.
          </h2>
          <p className="mx-auto mt-5 max-w-[550px] text-[14px] text-secondary leading-[1.7]">
            Monitor the questions buyers ask, compare the competitors that
            matter, and see the answer behind every result.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <DitherButton
              color="red"
              variant="gradient"
              bloom="off"
              className="h-10 rounded-none px-5 font-medium font-sans text-(--color-dither-button-text) text-[13px] transition-transform duration-150 active:scale-98"
              onClick={() => {
                window.location.href = to;
              }}
            >
              start monitoring
            </DitherButton>
            {!authed && (
              <a href={SIGN_IN_URL} className="btn-secondary h-10 px-5">
                sign in
              </a>
            )}
          </div>
        </LandingInset>
      </LandingContainer>
    </section>
  );
};
