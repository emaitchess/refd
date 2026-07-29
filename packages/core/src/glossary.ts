export interface GlossaryDefinition<Category extends string = string> {
  id: string;
  title: string;
  category: Category;
  definition: string;
  details: string;
}

export const TERM_CATEGORIES = [
  'Tracking setup',
  'AI answers',
  'Collection and scoring',
] as const;

export type TermCategory = (typeof TERM_CATEGORIES)[number];

export const GLOSSARY_TERMS: GlossaryDefinition<TermCategory>[] = [
  {
    id: 'workspace',
    title: 'Workspace',
    category: 'Tracking setup',
    definition:
      'An isolated monitoring project for one brand and its competitive landscape.',
    details:
      'A workspace has its own tracked entities, prompts, AI surfaces, runs, and results. Switching workspaces never mixes their data.',
  },
  {
    id: 'brand',
    title: 'Brand',
    category: 'Tracking setup',
    definition: 'The primary entity a workspace is created to monitor.',
    details:
      'The brand is scored with the same mention, citation, position, and sentiment rules as its competitors, while remaining the reference point for dashboard summaries.',
  },
  {
    id: 'competitor',
    title: 'Competitor',
    category: 'Tracking setup',
    definition:
      'A company or product tracked alongside the workspace brand for comparison.',
    details:
      'Competitors define the comparison set used by share of voice and other competitive metrics. Changing the set can change relative metrics in future results.',
  },
  {
    id: 'tracked-entity',
    title: 'Tracked entity',
    category: 'Tracking setup',
    definition:
      'A brand or competitor that refd looks for in AI answers and citations.',
    details:
      'An entity has a primary name, one or more domains, and optional aliases. These identity settings determine which text and source URLs receive credit.',
  },
  {
    id: 'prompt',
    title: 'Prompt',
    category: 'Tracking setup',
    definition:
      'A question sent to each enabled AI surface during a collection run.',
    details:
      'Active prompts join future scheduled and manual runs. Disabling a prompt stops new collection for it without removing its historical results.',
  },
  {
    id: 'domain',
    title: 'Domain',
    category: 'Tracking setup',
    definition:
      'A website address assigned to a tracked entity for citation attribution.',
    details:
      'A valid source URL receives credit when its hostname matches an entity domain or one of its subdomains. An entity can have more than one domain.',
  },
  {
    id: 'alias',
    title: 'Alias',
    category: 'Tracking setup',
    definition:
      'An alternate name that should count as a mention of a tracked entity.',
    details:
      'Aliases are useful for abbreviations, former names, and product names. Case-exact matching prevents short or ambiguous terms from matching ordinary prose.',
  },
  {
    id: 'ai-surface',
    title: 'AI surface',
    category: 'AI answers',
    definition: 'An AI answer experience monitored as a separate data source.',
    details:
      'refd currently supports ChatGPT, Perplexity, Gemini, Google AI Mode, and Google AI Overviews. Each surface is collected and measured independently.',
  },
  {
    id: 'ai-answer',
    title: 'AI answer',
    category: 'AI answers',
    definition:
      'The response text and source list returned for one prompt, AI surface, and sample.',
    details:
      'Each answer is scored independently. Because generated answers can vary, trends across runs and samples are more reliable than one answer in isolation.',
  },
  {
    id: 'mention',
    title: 'Mention',
    category: 'AI answers',
    definition:
      'An occurrence of a tracked entity name or alias in the AI answer text.',
    details:
      'Mentions use word-aware matching and can be case-exact when configured. Being mentioned does not require the entity to be cited.',
  },
  {
    id: 'citation',
    title: 'Citation',
    category: 'AI answers',
    definition: 'A valid web source URL associated with an AI answer.',
    details:
      'Citation URLs are normalized and unsafe or non-web schemes are rejected. A tracked entity is cited when the source hostname matches one of its domains.',
  },
  {
    id: 'source',
    title: 'Source',
    category: 'AI answers',
    definition: 'A web page cited as supporting material for an AI answer.',
    details:
      'The Sources page groups cited URLs by domain so you can see which sites influence answers and which exact pages receive citations.',
  },
  {
    id: 'cited-domain',
    title: 'Cited domain',
    category: 'AI answers',
    definition:
      'The website hostname extracted from one or more cited source URLs.',
    details:
      'Grouping sources by domain shows how broadly a site appears across answers separately from the total number of URLs it contributes.',
  },
  {
    id: 'no-ai-overview',
    title: 'No AI Overview',
    category: 'AI answers',
    definition:
      'A valid Google search result in which Google did not show an AI Overview.',
    details:
      'This outcome is not a collection failure. It records that no AI answer was available to score for that prompt and sample.',
  },
  {
    id: 'run',
    title: 'Run',
    category: 'Collection and scoring',
    definition:
      'A collection batch covering the active prompts, enabled AI surfaces, and configured samples at a point in time.',
    details:
      'Runs freeze their prompt set when they start, so edits made during collection do not change the work already in progress.',
  },
  {
    id: 'run-trigger',
    title: 'Run trigger',
    category: 'Collection and scoring',
    definition: 'The event that started a collection run.',
    details:
      'Scheduled runs start automatically each day. Manual runs are started by a user, onboarding runs build the first report, and imported runs preserve historical data.',
  },
  {
    id: 'sample',
    title: 'Sample',
    category: 'Collection and scoring',
    definition:
      'One independent attempt to collect an answer for the same prompt and AI surface.',
    details:
      'Multiple samples reduce the influence of any single non-deterministic answer. Metrics average samples within each prompt and surface before combining them.',
  },
  {
    id: 'collection-unit',
    title: 'Collection unit',
    category: 'Collection and scoring',
    definition:
      'One result for a specific prompt, AI surface, and sample within a run.',
    details:
      'A successful unit completed provider collection. For Google AI Overviews, a successful unit may still contain no overview because that is a valid outcome.',
  },
  {
    id: 'scoring',
    title: 'Scoring',
    category: 'Collection and scoring',
    definition:
      'The process that turns a collected answer into entity and citation signals.',
    details:
      'Scoring detects mentions, their order and prominence, sentiment, and attributable citations. Stored scoring versions keep historical calculations auditable.',
  },
  {
    id: 'raw-answer-payload',
    title: 'Raw answer payload',
    category: 'Collection and scoring',
    definition:
      'The original provider response retained behind a scored collection unit.',
    details:
      'Raw payloads act as receipts for the displayed result and allow stored answers to be rescored without spending provider quota again.',
  },
];
