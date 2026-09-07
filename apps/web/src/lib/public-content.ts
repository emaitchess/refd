import { getCollection } from 'astro:content';
import { glossaryEntriesByCategory } from '@refd/core/glossary-index';
import { contentPath, isPublished } from './content';

export interface PublicContentEntry {
  path: string;
  title: string;
  description: string;
  publishedAt: Date;
  order: number;
  answer: string;
  body: string;
  section:
    | 'Blog'
    | 'Documentation'
    | 'Glossary'
    | 'Guides'
    | 'Legal'
    | 'Trackers'
    | 'Trust';
}

const trustPageIds = new Set(['open-source', 'security', 'support']);

// Metric and term definitions are generated from the same structured source the
// dashboard and the MCP server read, so they can never drift between them.
// Concepts are editorial category vocabulary and say so, because an agent
// reading this markdown cannot otherwise tell the two apart.
const GLOSSARY_PUBLISHED_AT = new Date('2026-09-04T00:00:00.000Z');

const KIND_LABELS = {
  metric: 'Metric',
  term: 'Term',
  concept: 'Concept',
} as const;

const glossaryEntries = (): PublicContentEntry[] =>
  glossaryEntriesByCategory().flatMap((group) =>
    group.entries.map((entry) => ({
      path: entry.path,
      title: entry.title,
      description: entry.definition,
      publishedAt: GLOSSARY_PUBLISHED_AT,
      order: 500,
      answer: entry.definition,
      body: [
        `## ${entry.kind === 'concept' ? 'What it means in practice' : 'How it is calculated'}`,
        '',
        entry.details,
        '',
        '## Category',
        '',
        `${KIND_LABELS[entry.kind]} in ${group.category}.`,
        entry.kind === 'concept'
          ? 'This definition is editorial category vocabulary, not a metric refd computes.'
          : 'This definition is read from the same source the refd product reads.',
      ].join('\n'),
      section: 'Glossary' as const,
    })),
  );

export const getPublicContent = async (): Promise<PublicContentEntry[]> => {
  const pages = (await getCollection('pages')).filter(isPublished).map(
    (entry): PublicContentEntry => ({
      path: contentPath('pages', entry.id),
      title: entry.data.title,
      description: entry.data.description,
      publishedAt: entry.data.publishedAt,
      order: entry.data.order,
      answer: entry.data.answer,
      body: entry.body ?? '',
      section:
        entry.data.layout === 'legal'
          ? 'Legal'
          : entry.data.layout === 'surface'
            ? 'Trackers'
            : trustPageIds.has(entry.id)
              ? 'Trust'
              : 'Guides',
    }),
  );
  const docs = (await getCollection('docs')).filter(isPublished).map(
    (entry): PublicContentEntry => ({
      path: contentPath('docs', entry.id),
      title: entry.data.title,
      description: entry.data.description,
      publishedAt: entry.data.publishedAt,
      order: entry.data.order,
      answer: entry.data.answer,
      body: entry.body ?? '',
      section: 'Documentation',
    }),
  );
  const blog = (await getCollection('blog')).filter(isPublished).map(
    (entry): PublicContentEntry => ({
      path: contentPath('blog', entry.id),
      title: entry.data.title,
      description: entry.data.description,
      publishedAt: entry.data.publishedAt,
      order: entry.data.order,
      answer: entry.data.answer,
      body: entry.body ?? '',
      section: 'Blog',
    }),
  );

  return [...pages, ...docs, ...blog, ...glossaryEntries()].sort(
    (left, right) =>
      left.order - right.order ||
      right.publishedAt.getTime() - left.publishedAt.getTime(),
  );
};
