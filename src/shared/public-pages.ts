export const PUBLIC_SITE_ORIGIN = 'https://refd.ai';

export const PUBLIC_PAGE_PATHS = {
  landing: '/',
} as const;

// Only public, canonical HTML pages belong here. Authenticated and utility
// routes must never be advertised as indexable URLs.
export const INDEXABLE_PUBLIC_PATHS = [PUBLIC_PAGE_PATHS.landing] as const;
