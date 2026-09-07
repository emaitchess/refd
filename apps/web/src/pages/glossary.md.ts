import { glossaryEntriesByCategory } from '@refd/core/glossary-index';
import type { APIRoute } from 'astro';
import { markdownIndexDocument, markdownResponse } from '../lib/markdown';

export const GET: APIRoute = () =>
  markdownResponse(
    markdownIndexDocument({
      title: 'refd AI search monitoring glossary',
      introduction:
        'Definitions for AI search visibility measurement: every metric and term refd uses, plus the category vocabulary the field argues about. Metric and term definitions are read from the same source the product reads, so they cannot drift from the software. Concepts are editorial.',
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
