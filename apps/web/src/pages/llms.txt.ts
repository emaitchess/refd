import type { APIRoute } from 'astro';
import {
  getPublicContent,
  type PublicContentEntry,
} from '../lib/public-content';

const ORIGIN = 'https://refd.ai';

const item = (title: string, url: string, note: string): string =>
  `- [${title}](${url}): ${note}`;

// llms.txt lists markdown, not HTML: every public page is also served at the
// same path with `.md` appended, and the spec asks the file to link the
// LLM-friendly version.
const contentItem = (entry: PublicContentEntry): string =>
  item(entry.title, `${ORIGIN}${entry.path}.md`, entry.description);

const section = (title: string, items: string[]): string =>
  `## ${title}\n\n${items.join('\n')}`;

export const GET: APIRoute = async () => {
  const entries = await getPublicContent();
  const inSection = (name: PublicContentEntry['section']): string[] =>
    entries.filter((entry) => entry.section === name).map(contentItem);

  const body = `# refd

> Auditable AI search monitoring for businesses. See where a brand appears in AI answers, who appears instead, and the raw answer behind every metric.

refd tracks buyer questions across ChatGPT, Perplexity, Gemini, Google AI Mode, and Google AI Overviews. It measures mentions, citations, first-mention position, sentiment, prominence, and share of voice while preserving the underlying answer evidence. Mentions and citations are independent signals, and a missing Google AI Overview is a valid observation rather than a failed fetch.

The hosted product runs at refd.ai. The complete stack is MIT licensed and can be self-hosted with separate infrastructure and collection accounts.

Every link below points to a markdown version of a page. Each one is served at the page's own URL with \`.md\` appended, so dropping the suffix gives the HTML original.

${section('Product', [
  item(
    'Homepage',
    `${ORIGIN}/index.md`,
    'What refd measures, how it collects, and who it is for.',
  ),
  item(
    'Interactive demo',
    `${ORIGIN}/demo.md`,
    'A no-signup sample visibility report where every metric links back to the answer it was scored from.',
  ),
  item(
    'Agent access',
    `${ORIGIN}/agents.md`,
    'The read-only MCP endpoint, its OAuth model and personal access tokens for headless agents, the nine tools, and how to connect a client.',
  ),
])}

${section('Guides', inSection('Guides'))}

${section('Documentation', [
  item(
    'Documentation',
    `${ORIGIN}/docs.md`,
    'Setup and operating guides for hosted and self-hosted deployments.',
  ),
  ...inSection('Documentation'),
])}

${section('Surface trackers', [
  item(
    'AI surface trackers',
    `${ORIGIN}/trackers.md`,
    'One measurement contract applied separately to each AI answer surface.',
  ),
  ...inSection('Trackers'),
])}

${section('Research and analysis', [
  item(
    'Research and guides',
    `${ORIGIN}/blog.md`,
    'Published analysis and field notes on measuring AI search visibility.',
  ),
  ...inSection('Blog'),
])}

${section('Glossary', [
  item(
    'Glossary',
    `${ORIGIN}/glossary.md`,
    'Every metric and term refd measures, read from the same definitions the product reads, plus the category vocabulary of AI search visibility.',
  ),
  ...inSection('Glossary'),
])}

${section('Project', [
  ...inSection('Trust'),
  item(
    'Source code',
    'https://github.com/emaitchess/refd',
    'The MIT-licensed implementation of the whole stack.',
  ),
  item(
    'Design system',
    'https://github.com/emaitchess/refd/blob/main/docs/DESIGN.md',
    'The public UI and charting rules the dashboard follows.',
  ),
])}

${section('Account', [
  item(
    'Create an account',
    'https://dash.refd.ai/auth/create-account',
    'Start a hosted workspace.',
  ),
  item(
    'Sign in',
    'https://dash.refd.ai/auth/sign-in',
    'Return to an existing workspace.',
  ),
])}

${section('Optional', [
  item(
    'Full text of every public page',
    `${ORIGIN}/llms-full.txt`,
    'The same documents listed above, expanded inline in one file.',
  ),
  ...inSection('Legal'),
  item(
    'RSS',
    `${ORIGIN}/rss.xml`,
    'Subscribe to published research and documentation.',
  ),
  item(
    'Issues',
    'https://github.com/emaitchess/refd/issues',
    'Report a bug or request a feature.',
  ),
])}
`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
