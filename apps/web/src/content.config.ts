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

const surfaceMetricSchema = z.object({
  label: z.string().min(1).max(40),
  value: z.string().min(1).max(20),
  detail: z.string().min(1).max(100),
});

const surfaceSchema = z.object({
  key: z.enum([
    'chatgpt',
    'perplexity',
    'gemini',
    'google-ai-mode',
    'google-ai-overviews',
  ]),
  label: z.string().min(1).max(40),
  collection: z.string().min(1).max(80),
  sampling: z.string().min(1).max(100),
  metrics: z.array(surfaceMetricSchema).length(4),
  samplePrompt: z.string().min(1).max(180),
  sampleSignal: z.string().min(1).max(80),
  sampleFinding: z.string().min(1).max(300),
  limitation: z.string().min(1).max(300),
});

const contentSchema = z
  .object({
    title: z.string().min(1).max(100),
    description: z.string().min(1).max(180),
    eyebrow: z.string().min(1).max(40),
    answer: z.string().min(1).max(500),
    layout: z.enum(['article', 'legal', 'surface']).default('article'),
    surface: surfaceSchema.optional(),
    publishedAt: z.coerce.date(),
    updatedAt: z.coerce.date().optional(),
    author: authorSchema,
    order: z.number().int().nonnegative().default(0),
    draft: z.boolean().default(false),
    related: z.array(relatedSchema).max(4).default([]),
  })
  .superRefine((value, context) => {
    if (value.layout === 'surface' && value.surface === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Surface pages require surface metadata.',
        path: ['surface'],
      });
    }
    if (value.layout !== 'surface' && value.surface !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Surface metadata is only valid for surface pages.',
        path: ['surface'],
      });
    }
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
