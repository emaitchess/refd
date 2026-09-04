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

// The glossary is generated from the same structured definitions the dashboard
// and the MCP server read, so a definition can never drift between them.
const GLOSSARY_PUBLISHED_AT = new Date('2026-09-04T00:00:00.000Z');

const glossaryEntries = (): PublicContentEntry[] =>
  glossaryEntriesByCategory().flatMap((group) =>
    group.entries.map((entry) => ({
      path: entry.path,
      title: entry.title,
      description: entry.definition,
      publishedAt: GLOSSARY_PUBLISHED_AT,
      order: 500,
      answer: entry.definition,
      body: `## How it is calculated\n\n${entry.details}\n\n## Category\n\n${entry.kind === 'metric' ? 'Metric' : 'Term'} in ${group.category}.`,
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
