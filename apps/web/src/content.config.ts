import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const authorSchema = z.object({
  name: z.string().min(1).max(80),
  url: z.string().url().optional(),
});

const relatedSchema = z.object({
  href: z.string().startsWith('/'),
  title: z.string().min(1).max(100),
  description: z.string().min(1).max(220),
});

const contentSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().min(1).max(180),
  eyebrow: z.string().min(1).max(40),
  answer: z.string().min(1).max(500),
  publishedAt: z.coerce.date(),
  updatedAt: z.coerce.date().optional(),
  author: authorSchema,
  order: z.number().int().nonnegative().default(0),
  draft: z.boolean().default(false),
  related: z.array(relatedSchema).max(4).default([]),
});

const pages = defineCollection({
  loader: glob({ base: './src/content/pages', pattern: '**/*.md' }),
  schema: contentSchema,
});

const docs = defineCollection({
  loader: glob({ base: './src/content/docs', pattern: '**/*.md' }),
  schema: contentSchema,
});

const blog = defineCollection({
  loader: glob({ base: './src/content/blog', pattern: '**/*.md' }),
  schema: contentSchema,
});

export const collections = { pages, docs, blog };
