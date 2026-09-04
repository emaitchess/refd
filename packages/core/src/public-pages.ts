import { GLOSSARY_ENTRY_PATHS } from './glossary-index';

export const PUBLIC_SITE_ORIGIN = 'https://refd.ai';

export const PUBLIC_PAGE_PATHS = [
  '/',
  '/agents',
  '/blog',
  '/blog/what-is-ai-search-monitoring',
  '/blog/ai-mentions-vs-citations',
  '/blog/one-answer-is-not-a-measurement',
  '/blog/how-to-rank-in-ai-overviews',
  '/demo',
  '/docs',
  '/docs/getting-started',
  '/glossary',
  '/methodology',
  '/open-source',
  '/privacy',
  '/security',
  '/support',
  '/terms',
  '/trackers',
  '/chatgpt-visibility-tracker',
  '/perplexity-visibility-tracker',
  '/gemini-visibility-tracker',
  '/google-ai-mode-tracker',
  '/google-ai-overview-tracker',
  ...GLOSSARY_ENTRY_PATHS,
];

export const INDEXABLE_PUBLIC_PATHS = [...PUBLIC_PAGE_PATHS];
