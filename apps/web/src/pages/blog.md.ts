import type { APIRoute } from 'astro';
import { markdownIndexDocument, markdownResponse } from '../lib/markdown';
import { getPublicContent } from '../lib/public-content';

export const GET: APIRoute = async () => {
  const posts = (await getPublicContent()).filter(
    (entry) => entry.section === 'Blog',
  );
  return markdownResponse(
    markdownIndexDocument({
      title: 'refd research and guides',
      introduction:
        'Original research, practical measurement guidance, and transparent analysis of how brands appear in AI-generated answers.',
      sections: [
        {
          title: 'Published notes',
          entries: posts.map((entry) => ({
            title: entry.title,
            description: entry.description,
            href: `${entry.path}.md`,
          })),
          empty:
            'The first research note is in preparation. New research and field notes will appear here and in the RSS feed.',
        },
        {
          title: 'Foundation',
          entries: [
            {
              title: 'How refd measures AI search visibility',
              description:
                'The definitions, denominators, safeguards, and limitations behind every reported metric.',
              href: '/methodology.md',
            },
            {
              title: 'Getting started with refd',
              description:
                'Build a first workspace and learn how to inspect the answer evidence behind its report.',
              href: '/docs/getting-started.md',
            },
          ],
        },
      ],
    }),
  );
};
