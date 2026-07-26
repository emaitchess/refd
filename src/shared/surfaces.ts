export const SURFACES = [
  'chatgpt',
  'perplexity',
  'gemini',
  'google_ai_mode',
  'google_aio',
] as const;
export type Surface = (typeof SURFACES)[number];

// Display names for AI answer surfaces. Shared because copy is composed on
// both sides: the dashboard renders these labels, and the server writes them
// into change-alert headlines and Home chip questions — one map, no drift.
export const SURFACE_LABELS: Record<Surface, string> = {
  chatgpt: 'ChatGPT',
  perplexity: 'Perplexity',
  gemini: 'Gemini',
  google_ai_mode: 'AI Mode',
  google_aio: 'AI Overview',
};

export const surfaceLabel = (surface: string): string =>
  Object.hasOwn(SURFACE_LABELS, surface)
    ? SURFACE_LABELS[surface as Surface]
    : surface;

export const SURFACE_ORDER: string[] = [...SURFACES];
