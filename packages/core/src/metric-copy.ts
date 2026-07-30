import type { GlossaryDefinition } from './glossary';

export type MetricCategory =
  | 'Visibility'
  | 'Competition'
  | 'Citations'
  | 'Answer analysis'
  | 'Changes';

export type MetricDefinition = GlossaryDefinition<MetricCategory>;

export const METRIC_CATEGORIES: MetricCategory[] = [
  'Visibility',
  'Competition',
  'Citations',
  'Answer analysis',
  'Changes',
];

export const METRIC_INFO = {
  mentionRate: {
    id: 'mention-rate',
    title: 'Mention rate',
    category: 'Visibility',
    definition:
      'The percentage of scored AI answers that name the tracked brand or competitor.',
    details:
      'Only successful results with an answer are eligible. Samples are averaged per prompt and AI surface so each tracked prompt and surface cell carries equal weight.',
  },
  citationRate: {
    id: 'citation-rate',
    title: 'Citation rate',
    category: 'Citations',
    definition:
      'The percentage of scored AI answers that cite a page from this brand or competitor.',
    details:
      'The calculation uses the same eligible answers and cell weighting as mention rate. An answer with no sources counts as zero citation visibility.',
  },
  shareOfVoice: {
    id: 'share-of-voice',
    title: 'Share of voice',
    category: 'Competition',
    definition:
      'Of all tracked brand mentions, the percentage that belongs to this brand or competitor.',
    details:
      'Each answer contributes at most one mention per tracked entity, even when a name repeats. The tracked competitor set defines the pool, so changing that set can change every share.',
  },
  sovGap: {
    id: 'share-of-voice-gap',
    title: 'Share of voice gap',
    category: 'Competition',
    definition:
      "Your brand's share of voice minus the strongest competitor's. A positive value means your brand is ahead.",
    details:
      'The value is shown in percentage points. It is unavailable until the workspace tracks at least one competitor and the selected range contains mentions.',
  },
  averagePosition: {
    id: 'average-position',
    title: 'Average position',
    category: 'Visibility',
    definition:
      'The average order in which the brand appears when it is mentioned. Position 1 means it was named first.',
    details:
      'Position is relative to the tracked entities and is averaged only across answers that mention the entity. Absence is represented by mention rate instead of a position penalty.',
  },
  firstNamed: {
    id: 'first-named',
    title: 'First named',
    category: 'Competition',
    definition:
      'When a tracked brand is named first, the percentage of those answers led by this brand.',
    details:
      'The denominator contains answers where at least one tracked entity is mentioned. When a winner exists, first-named shares sum to 100% across the tracked set.',
  },
  surfaceLeaders: {
    id: 'surface-leaders',
    title: 'Surface leaders',
    category: 'Competition',
    definition:
      'The brand or competitor with the highest mention rate on each AI surface in the selected range.',
    details:
      'This comparison makes differences between answer engines visible without blending their results into one overall leader.',
  },
  attributedCitations: {
    id: 'attributed-citations',
    title: 'Attributed citations',
    category: 'Citations',
    definition:
      'Citations that can be assigned to a recognizable domain. Opaque redirects are excluded.',
    details:
      'URLs are normalized before attribution. Redirects that cannot be resolved to their destination remain unattributed and never receive credit for a domain.',
  },
  brandUrlCitations: {
    id: 'brand-url-citations',
    title: 'Brand URL citations',
    category: 'Citations',
    definition:
      'The total number of times an exact page from your domain appeared as a cited source.',
    details:
      'Each distinct normalized URL is counted per answer. One answer can therefore contribute more than one brand URL citation.',
  },
  sourceGap: {
    id: 'source-gap',
    title: 'Source gap',
    category: 'Citations',
    definition:
      'Domains cited in answers where your brand was neither mentioned nor cited.',
    details:
      'These domains reveal sources that influence relevant answers without currently giving your brand direct visibility.',
  },
  answersCiting: {
    id: 'answers-citing',
    title: 'Answers citing',
    category: 'Citations',
    definition:
      'The number of distinct AI answers that cite at least one page from this domain.',
    details:
      'An answer counts once for the domain regardless of how many different pages from that domain it cites.',
  },
  citations: {
    id: 'citations',
    title: 'Citations',
    category: 'Citations',
    definition:
      'The total cited URLs from this domain. One answer can contain more than one citation.',
    details:
      'This is a URL count rather than an answer count. Use Answers citing to measure how broadly the domain appears across answers.',
  },
  promptSignals: {
    id: 'prompt-result-signals',
    title: 'Prompt result signals',
    category: 'Visibility',
    definition:
      'M is mention rate and C is citation rate for each AI surface. None means the answer was scored but contained neither signal.',
    details:
      'Mentioned and cited are independent. An answer can name the brand without citing it, cite the brand without naming it, contain both signals, or contain neither.',
  },
  sentiment: {
    id: 'sentiment',
    title: 'Sentiment',
    category: 'Answer analysis',
    definition:
      'How AI answers portray this brand or competitor when it is mentioned, as positive, neutral, and negative shares of classified mentions.',
    details:
      'Only classified mentions enter the distribution. Unclassified historical answers and classification failures are excluded instead of being treated as neutral.',
  },
  positiveSentiment: {
    id: 'positive-sentiment',
    title: 'Positive sentiment',
    category: 'Answer analysis',
    definition:
      'Of the answers that mention the brand, the percentage whose portrayal is classified as positive.',
    details:
      'Answers that never mention the brand have no stance to measure and are excluded, as are mentions whose classification is still pending. This is a share of classified mentions, not an average: sentiment is categorical and is never collapsed into a composite score.',
  },
  materialChange: {
    id: 'material-change',
    title: 'Material change',
    category: 'Changes',
    definition:
      'A movement between the two most recent completed runs large enough to outrank sampling noise: 15 points for mention and citation rates, 10 points for share of voice, 20 points for sentiment shares, and one full rank for average position.',
    details:
      'Runs are compared only over the cells (one prompt on one surface) that both runs actually answered, so a partial run can never fabricate a change. That count is usually smaller than prompts times surfaces, because a surface that returned no answer for a prompt leaves nothing to compare. Share of voice, position, and competitor comparisons pause when the tracked competitor set changed between the runs, because those metrics are relative to that set. Smaller movements stay silent: AI answers are sampled and non-deterministic, and run-to-run wobble below these thresholds is noise rather than news.',
  },
} as const satisfies Record<string, MetricDefinition>;

export const METRIC_GLOSSARY: MetricDefinition[] = Object.values(METRIC_INFO);

export const metricGlossaryHref = (metric: MetricDefinition) =>
  `/help/glossary#${metric.id}`;
