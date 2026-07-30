export interface SurfaceMetric {
  label: string;
  value: string;
  detail: string;
}

export interface SurfacePageDetails {
  key:
    | 'chatgpt'
    | 'perplexity'
    | 'gemini'
    | 'google-ai-mode'
    | 'google-ai-overviews';
  label: string;
  collection: string;
  sampling: string;
  metrics: SurfaceMetric[];
  samplePrompt: string;
  sampleSignal: string;
  sampleFinding: string;
  limitation: string;
}
