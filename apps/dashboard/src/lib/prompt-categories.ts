import type { GlossaryDefinition } from '@refd/core/glossary';
import type { PixelColor } from '@/components/dither-kit/pixel';
import { fnv1a } from '@/components/dither-kit/pixel';

export const UNCATEGORIZED_CATEGORY = 'Uncategorized';

export const PROMPT_CATEGORIES = [
  'Discovery',
  'Evaluation',
  'Comparison',
  'Decision',
  'Authority',
] as const;

export type PromptCategory = (typeof PROMPT_CATEGORIES)[number];

export const PROMPT_CATEGORY_EXPLAINERS: Record<PromptCategory, string> = {
  Discovery: 'Broad problem and category questions.',
  Evaluation: 'Capabilities, use cases, and product fit.',
  Comparison: 'Shortlists, alternatives, and head-to-heads.',
  Decision: 'Pricing, value, and purchase confidence.',
  Authority: 'Expert questions where trusted sources shape answers.',
};

export type PromptCategoryDefinition = GlossaryDefinition<'Prompt categories'>;

export const PROMPT_CATEGORY_GLOSSARY: PromptCategoryDefinition[] = [
  {
    id: 'prompt-category-discovery',
    title: 'Discovery',
    category: 'Prompt categories',
    definition:
      'Broad problem and category questions asked before someone is considering a specific brand.',
    details:
      'These prompts reveal which products and approaches AI recommends at the beginning of a search. They usually do not name your brand.',
  },
  {
    id: 'prompt-category-evaluation',
    title: 'Evaluation',
    category: 'Prompt categories',
    definition:
      'Questions about capabilities, features, use cases, and product fit.',
    details:
      'These prompts measure whether AI presents a solution as capable of solving a particular problem or working for a particular audience.',
  },
  {
    id: 'prompt-category-comparison',
    title: 'Comparison',
    category: 'Prompt categories',
    definition:
      'Questions about shortlists, alternatives, best options, and head-to-head comparisons.',
    details:
      'These prompts show how AI positions your brand against competitors. Some may name a brand or competitor directly.',
  },
  {
    id: 'prompt-category-decision',
    title: 'Decision',
    category: 'Prompt categories',
    definition:
      'Questions about pricing, value, suitability, and purchase confidence.',
    details:
      'These prompts capture the final checks someone makes when deciding whether a product is worth choosing for their needs.',
  },
  {
    id: 'prompt-category-authority',
    title: 'Authority',
    category: 'Prompt categories',
    definition:
      'Expert and industry questions where trusted sources shape the answer.',
    details:
      'These prompts measure whether AI relies on your brand as a credible source of knowledge, even when the question is not about buying a product.',
  },
  {
    id: 'prompt-category-uncategorized',
    title: UNCATEGORIZED_CATEGORY,
    category: 'Prompt categories',
    definition: 'Prompts that do not have a category tag.',
    details:
      'New prompts use a predefined buyer journey category. Existing prompts keep any custom first tag, while an empty or missing first tag appears as Uncategorized.',
  },
];

const CATEGORY_COLORS: Record<string, PixelColor> = {
  discovery: 'blue',
  evaluation: 'purple',
  comparison: 'orange',
  decision: 'green',
  authority: 'pink',
  uncategorized: 'grey',
};

export const promptCategory = (tags: readonly string[]): string =>
  tags[0]?.trim() || UNCATEGORIZED_CATEGORY;

// Canonical buyer-journey categories keep an explicit CVD-safe mapping. Custom
// categories get a stable hue from their name so their identity survives every
// view without storing presentation data in D1.
export const promptCategoryColor = (category: string): PixelColor => {
  const normalized = category.trim().toLocaleLowerCase();
  return (
    CATEGORY_COLORS[normalized] ?? fnv1a(normalized || 'uncategorized') % 360
  );
};
