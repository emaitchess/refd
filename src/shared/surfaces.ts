// Display names for AI answer surfaces. Shared because copy is composed on
// both sides: the dashboard renders these labels, and the server writes them
// into change-alert headlines and Home chip questions — one map, no drift.
export const SURFACE_LABELS: Record<string, string> = {
  chatgpt: 'ChatGPT',
  perplexity: 'Perplexity',
  gemini: 'Gemini',
  google_ai_mode: 'AI Mode',
  google_aio: 'AI Overview',
};

export const surfaceLabel = (surface: string): string =>
  SURFACE_LABELS[surface] ?? surface;

// Canonical display order of answer surfaces — the insertion order of SURFACE_LABELS.
export const SURFACE_ORDER = Object.keys(SURFACE_LABELS);
