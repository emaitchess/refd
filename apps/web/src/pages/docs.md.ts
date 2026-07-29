import type { APIRoute } from 'astro';
import { markdownIndexDocument, markdownResponse } from '../lib/markdown';
import { getPublicContent } from '../lib/public-content';

export const GET: APIRoute = async () => {
  const docs = (await getPublicContent()).filter(
    (entry) => entry.section === 'Documentation',
  );
  return markdownResponse(
    markdownIndexDocument({
      title: 'refd documentation',
      introduction:
        'Set up a workspace, choose representative buyer questions, understand each metric, and trace the report back to the AI answers that produced it.',
      sections: [
        {
          title: 'Guides',
          entries: docs.map((entry) => ({
            title: entry.title,
            description: entry.description,
            href: `${entry.path}.md`,
          })),
        },
        {
          title: 'Reference',
          entries: [
            {
              title: 'How refd measures AI search visibility',
              description:
                'Collection, repeated sampling, scoring, aggregation, auditability, and the limits of every metric.',
              href: '/methodology.md',
            },
            {
              title: 'Connect through MCP',
              description:
                'Read a workspace from Claude, ChatGPT, or any compatible client with one revocable read-only grant.',
              href: '/agents',
            },
          ],
        },
      ],
    }),
  );
};
