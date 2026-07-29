import { SURFACES, type Surface } from '@refd/core/surfaces';

export type { Surface };
export { SURFACES };

export const DATASET_SURFACES = [
  'chatgpt',
  'perplexity',
  'gemini',
  'google_ai_mode',
] as const;
export type DatasetSurface = (typeof DATASET_SURFACES)[number];

// Resolve a workspace's stored surface selection to a validated subset of
// SURFACES. Null/empty/all-invalid falls back to every surface (the default).
export const enabledSurfaces = (
  stored: string[] | null | undefined,
  max: number = SURFACES.length,
): Surface[] => {
  const boundedMax = Math.max(1, Math.min(max, SURFACES.length));
  if (!stored || stored.length === 0) {
    return SURFACES.slice(0, boundedMax);
  }
  const set = new Set(stored);
  const filtered = SURFACES.filter((s) => set.has(s));
  return (filtered.length > 0 ? filtered : [...SURFACES]).slice(0, boundedMax);
};

export interface NormalizedAnswer {
  // Canonical visible answer (markdown) — what a user would read on that
  // surface. Mention scoring reads this and nothing else.
  answerText: string;
  // Provider-labeled source list in display order (citation tier 1; index →
  // source rank). Inline links and the deep-walk fallback are harvested at
  // scoring time.
  sourceUrls: string[];
  // False only for google_aio when Google served no AI Overview — a valid
  // observation, not a failure.
  answerPresent: boolean;
  raw: unknown;
}
