import { glossaryEntriesByCategory } from '@refd/core/glossary-index';
import type { APIRoute } from 'astro';
import { markdownIndexDocument, markdownResponse } from '../lib/markdown';

export const GET: APIRoute = () =>
  markdownResponse(
    markdownIndexDocument({
      title: 'refd AI search monitoring glossary',
      introduction:
        'Definitions for every metric and term refd uses to measure AI search visibility, including how each number is calculated and where it stops being reliable. These are read from the same source the product reads, so they cannot drift from the software.',
      sections: glossaryEntriesByCategory().map((group) => ({
        title: group.category,
        entries: group.entries.map((entry) => ({
          title: entry.title,
          description: entry.definition,
          href: `${entry.path}.md`,
        })),
      })),
    }),
  );
