import { Link } from 'react-router';
import { DitherIcon } from '@/components/dither/DitherIcon';
import { Tooltip } from '@/components/dither-kit/tooltip';
import { type MetricDefinition, metricGlossaryHref } from '@/lib/metric-copy';

export const MetricInfo = ({
  label,
  metric,
  // The glossary lives behind RequireOnboarded — pre-onboarding surfaces
  // (the report) pass false so the link never bounces to the wizard.
  glossaryLink = true,
}: {
  label: string;
  metric: MetricDefinition;
  glossaryLink?: boolean;
}) => (
  <Tooltip
    asChild
    interactive
    content={
      <span className="block">
        <span className="block">{metric.definition}</span>
        {glossaryLink ? (
          <Link
            to={metricGlossaryHref(metric)}
            className="btn-secondary mt-2 h-7 px-2 text-[11px]"
          >
            Learn more
          </Link>
        ) : null}
      </span>
    }
    delay={0}
    closeDelay={120}
    placement="bottom"
    offset={7}
    className="z-[80] w-64 whitespace-normal border-border-strong bg-bg-elevated px-3 py-2 text-left font-sans text-[12px] text-secondary normal-case leading-relaxed tracking-normal shadow-lg"
  >
    <button
      type="button"
      aria-label={`What ${label} means`}
      className="inline-flex size-5 shrink-0 cursor-help items-center justify-center text-muted transition-colors hover:text-primary focus-visible:text-primary"
    >
      <DitherIcon name="info" size={12} />
    </button>
  </Tooltip>
);
