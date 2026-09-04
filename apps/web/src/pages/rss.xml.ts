import rss from '@astrojs/rss';
import type { APIRoute } from 'astro';
import { getPublicContent } from '../lib/public-content';

export const GET: APIRoute = async ({ site }) => {
  const entries = (await getPublicContent()).filter(
    (entry) => entry.section !== 'Legal' && entry.section !== 'Glossary',
  );

  return rss({
    title: 'refd research and documentation',
    description:
      'Research, methodology, and practical documentation for auditable AI search monitoring.',
    site: site ?? 'https://refd.ai',
    trailingSlash: false,
    items: entries.map((entry) => ({
      title: entry.title,
      description: entry.description,
      pubDate: entry.publishedAt,
      link: entry.path,
      categories: [entry.section],
    })),
    customData: '<language>en-us</language>',
  });
};
