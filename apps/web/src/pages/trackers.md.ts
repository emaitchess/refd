import { getCollection } from 'astro:content';
import type { APIRoute } from 'astro';
import { contentPath, isPublished } from '../lib/content';
import { markdownIndexDocument, markdownResponse } from '../lib/markdown';

export const GET: APIRoute = async () => {
  const entries = (await getCollection('pages'))
    .filter((entry) => isPublished(entry) && entry.data.layout === 'surface')
    .sort((left, right) => left.data.order - right.data.order);

  return markdownResponse(
    markdownIndexDocument({
      title: 'AI surface visibility trackers',
      introduction:
        'Monitor the same buyer questions across ChatGPT, Perplexity, Gemini, Google AI Mode, and Google AI Overviews. refd keeps each surface separate while applying one auditable measurement contract to mentions, citations, position, sentiment, prominence, and share of voice.',
      sections: [
        {
          title: 'Trackers',
          entries: entries.map((entry) => ({
            href: `${contentPath('pages', entry.id)}.md`,
            title: entry.data.title,
            description: entry.data.description,
          })),
        },
        {
          title: 'Measurement',
          entries: [
            {
              href: '/methodology.md',
              title: 'How refd measures AI search visibility',
              description:
                'Scheduled collection, scoring, aggregation, and the evidence behind every metric.',
            },
            {
              href: '/demo.md',
              title: 'Interactive sample report',
              description:
                'Fabricated Ultrahuman data across five AI answer surfaces, with prompt and answer evidence.',
            },
          ],
        },
      ],
    }),
  );
};
