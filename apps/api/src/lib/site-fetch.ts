import {
  type SiteMetadata,
  siteMetadataSchema,
} from '@refd/core/site-metadata';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { validate } from './validate';

// The markdown Quick Action's success envelope; failures carry {success:false,…}.
const markdownResponseSchema = z.object({
  success: z.literal(true),
  result: z.string(),
});

const scrapeResponseSchema = z.object({
  success: z.literal(true),
  result: z.array(
    z.object({
      selector: z.string().catch(''),
      results: z
        .array(
          z.object({
            text: z.string().catch(''),
            attributes: z
              .array(
                z.object({
                  name: z.string().catch(''),
                  value: z.string().catch(''),
                }),
              )
              .catch([]),
          }),
        )
        .catch([]),
    }),
  ),
});

const SITE_META_SELECTORS = {
  title: 'title',
  description: 'meta[name="description"]',
  ogTitle: 'meta[property="og:title"]',
  ogDescription: 'meta[property="og:description"]',
  ogImage: 'meta[property="og:image"]',
} as const;

const MAX_CHARS = 8000;
const STATIC_TIMEOUT_MS = 8000;

const clip = (s: string): string => s.trim().slice(0, MAX_CHARS);

// Fetch a static file (llms.txt/llms-full.txt) over plain HTTP — free and fast.
// Returns null on error or when an HTML page is served in place of a real file
// (a common SPA catch-all that would otherwise poison the LLM input).
const tryStaticFile = async (
  domain: string,
  path: string,
): Promise<string | null> => {
  try {
    const res = await fetch(`https://${domain}/${path}`, {
      signal: AbortSignal.timeout(STATIC_TIMEOUT_MS),
      headers: { 'user-agent': 'refd-onboarding/1.0 (+https://refd.ai)' },
    });
    if (!res.ok) {
      return null;
    }
    if ((res.headers.get('content-type') ?? '').includes('text/html')) {
      return null;
    }
    const text = (await res.text()).trim();
    return text.length > 50 ? text : null;
  } catch {
    return null;
  }
};

// Render the homepage to markdown via the Browser Rendering markdown Quick Action
// (a binding call — no API token). Handles JS/SPA sites a plain fetch can't.
// Best-effort — returns null on any failure.
const renderMarkdown = async (
  env: AppEnv,
  domain: string,
): Promise<string | null> => {
  try {
    const res = await env.BROWSER.quickAction('markdown', {
      url: `https://${domain}/`,
      gotoOptions: { waitUntil: 'networkidle0' },
    });
    const body = validate(await res.json(), markdownResponseSchema);
    if (!body) {
      return null;
    }
    const text = body.result.trim();
    return text.length > 50 ? text : null;
  } catch {
    return null;
  }
};

export interface SiteText {
  text: string;
  source: 'llms-full.txt' | 'llms.txt' | 'rendered';
}

const scrapeValue = (
  groups: z.infer<typeof scrapeResponseSchema>['result'],
  selector: string,
  source: 'text' | 'content',
): string => {
  const element = groups.find((group) => group.selector === selector)
    ?.results[0];
  if (!element) {
    return '';
  }
  if (source === 'text') {
    return element.text;
  }
  return (
    element.attributes.find(
      (attribute) => attribute.name.toLocaleLowerCase() === 'content',
    )?.value ?? ''
  );
};

const absoluteHttpUrl = (value: string, baseUrl: string): string => {
  if (!value.trim()) {
    return '';
  }
  try {
    const url = new URL(value, baseUrl);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.href
      : '';
  } catch {
    return '';
  }
};

export const siteMetadataFromScrape = (
  value: unknown,
  baseUrl: string,
): SiteMetadata | null => {
  const body = validate(value, scrapeResponseSchema);
  if (!body) {
    return null;
  }
  const raw = {
    title:
      scrapeValue(body.result, SITE_META_SELECTORS.title, 'text') ||
      scrapeValue(body.result, SITE_META_SELECTORS.ogTitle, 'content'),
    description:
      scrapeValue(body.result, SITE_META_SELECTORS.description, 'content') ||
      scrapeValue(body.result, SITE_META_SELECTORS.ogDescription, 'content'),
    imageUrl: absoluteHttpUrl(
      scrapeValue(body.result, SITE_META_SELECTORS.ogImage, 'content'),
      baseUrl,
    ),
  };
  const metadata = validate(raw, siteMetadataSchema);
  return metadata && Object.values(metadata).some(Boolean) ? metadata : null;
};

export const fetchSiteMetadata = async (
  env: AppEnv,
  domain: string,
): Promise<SiteMetadata | null> => {
  const url = `https://${domain}/`;
  try {
    const response = await env.BROWSER.quickAction('scrape', {
      url,
      elements: Object.values(SITE_META_SELECTORS).map((selector) => ({
        selector,
      })),
      gotoOptions: { waitUntil: 'domcontentloaded', timeout: 15_000 },
      rejectResourceTypes: ['stylesheet', 'image', 'media', 'font'],
      cacheTTL: 3600,
      bestAttempt: true,
    });
    return siteMetadataFromScrape(await response.json(), url);
  } catch {
    return null;
  }
};

// Best-effort brand site text for the describe step: prefer an llms.txt manifest
// (free), else the rendered homepage as markdown. Null when nothing usable is
// found — the caller then asks the user to write the description by hand.
export const fetchSiteText = async (
  env: AppEnv,
  domain: string,
): Promise<SiteText | null> => {
  // The two llms manifests are free static GETs — fetch them together so a site
  // with neither doesn't eat two sequential timeouts before we try rendering.
  // Prefer the fuller manifest; both settle to null on miss (tryStaticFile catches).
  const [full, llms] = await Promise.all([
    tryStaticFile(domain, 'llms-full.txt'),
    tryStaticFile(domain, 'llms.txt'),
  ]);
  if (full) {
    return { text: clip(full), source: 'llms-full.txt' };
  }
  if (llms) {
    return { text: clip(llms), source: 'llms.txt' };
  }
  // Only pay for Browser Rendering when the free manifests are absent.
  const rendered = await renderMarkdown(env, domain);
  if (rendered) {
    return { text: clip(rendered), source: 'rendered' };
  }
  return null;
};
