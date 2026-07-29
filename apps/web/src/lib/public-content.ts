import { getCollection } from 'astro:content';
import { contentPath, isPublished } from './content';

export interface PublicContentEntry {
  path: string;
  title: string;
  description: string;
  publishedAt: Date;
  order: number;
  answer: string;
  body: string;
  section: 'Blog' | 'Documentation' | 'Guides';
}

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
      section: 'Guides',
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

  return [...pages, ...docs, ...blog].sort(
    (left, right) =>
      left.order - right.order ||
      right.publishedAt.getTime() - left.publishedAt.getTime(),
  );
};
