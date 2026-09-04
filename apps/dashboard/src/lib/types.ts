import type { SiteMetadata } from '@refd/core/site-metadata';

export interface EntityAlias {
  value: string;
  caseSensitive?: boolean;
}

export interface EntityInfo {
  id: number;
  name: string;
  domains: string[];
  aliases: EntityAlias[];
  isBrand: boolean;
  sortOrder: number;
}

// V2 metric values: null = undefined (empty denominator), rendered "—",
// never 0.
export interface TileValues {
  mentionRate: number | null;
  citationRate: number | null;
  sov: number | null;
  citationSov: number | null;
  avgPosition: number | null;
  firstMentionShare: number | null;
  answers: number;
}

export interface RunPointEntity {
  mentionRate: number | null;
  citationRate: number | null;
  sov: number | null;
  citationSov: number | null;
  avgPosition: number | null;
}

export interface OverviewPoint {
  runId: number;
  date: string;
  // Break-marker source: charts flag runs where the tracked set changed.
  entitySetHash: string | null;
  entities: Record<string, RunPointEntity>;
}

export interface SurfaceStat {
  surface: string;
  mentionRate: number | null;
  citationRate: number | null;
  avgPosition: number | null;
  answers: number;
}

export interface CoverageStats {
  aio: { present: number; total: number } | null;
  sources: { surface: string; withSources: number; total: number }[];
}

// Counts over classified mentions only; null = nothing classified in scope
// (sentiment lags scoring by a queue hop, and pre-sentiment history stays
// unclassified), rendered "—".
export type SentimentDist = {
  positive: number;
  neutral: number;
  negative: number;
} | null;

export interface OverviewResponse {
  range: string;
  entities: EntityInfo[];
  brandId: number;
  hasCompetitors: boolean;
  tiles: { current: TileValues | null; previous: TileValues | null };
  prominence: { lead: number; body: number; list: number } | null;
  sentiment: SentimentDist;
  coverage: CoverageStats;
  series: OverviewPoint[];
  surfaces: SurfaceStat[];
}

// One material movement in the brand's visibility, composed server-side
// (routes/changes.ts) so the card and the Home chips share copy. `span` says
// which comparison found it: 'shift' is week against previous week, 'drift'
// is a slide that held its direction across the whole trend span.
export interface ChangeEvent {
  type:
    | 'mention_rate'
    | 'citation_rate'
    | 'sov'
    | 'position'
    | 'sentiment'
    | 'competitor';
  span: 'shift' | 'drift';
  scope: string;
  entity: string;
  direction: 'up' | 'down';
  good: boolean;
  unit: 'share' | 'rank';
  current: number;
  previous: number;
  delta: number;
  severity: number;
  subject: string;
  headline: string;
  question: string;
}

export interface ChangeWindowRef {
  from: string;
  to: string;
  runs: number;
  answers: number;
  entitySetHash: string | null;
}

export interface ChangesResponse {
  needsSetup?: boolean;
  status?: 'ok' | 'needs-runs' | 'thin-overlap';
  windowDays?: number;
  latest?: ChangeWindowRef | null;
  previous?: ChangeWindowRef | null;
  trend?: ChangeWindowRef[];
  cells?: number;
  trendCells?: number;
  promptCount?: number;
  surfaceCount?: number;
  entitySetChanged?: boolean;
  events?: ChangeEvent[];
}

export interface PromptRow {
  id: number;
  text: string;
  tags: string[];
  active: boolean;
  // Brand's stance distribution across the prompt's classified mentions.
  sentiment: SentimentDist;
  surfaces: {
    surface: string;
    mentionRate: number | null;
    citationRate: number | null;
    answers: number;
  }[];
  trend: { runId: number; date: string; mentionRate: number | null }[];
}

export interface SourcesResponse {
  range: string;
  domains: {
    domain: string;
    isOurs: boolean;
    citationCount: number;
    resultCount: number;
  }[];
  unattributable: number;
  ourUrls: { url: string; count: number }[];
  gap: { domain: string; resultCount: number }[];
}

export interface CompetitorEntity extends EntityInfo {
  mentionRate: number | null;
  citationRate: number | null;
  sov: number | null;
  citationSov: number | null;
  avgPosition: number | null;
  firstMentionShare: number | null;
  sentiment: SentimentDist;
  surfaces: { surface: string; mentionRate: number | null }[];
}

export interface CompetitorsResponse {
  range: string;
  entities: CompetitorEntity[];
  series: OverviewPoint[];
}

export interface RunRow {
  id: number;
  key: string;
  date: string;
  trigger: 'cron' | 'manual' | 'import' | 'onboard';
  status: 'running' | 'complete' | 'failed';
  okCount: number;
  totalCount: number;
  createdAt: number;
  completedAt: number | null;
}

export interface OnboardingCompetitor {
  name: string;
  domains: string[];
  aliases: EntityAlias[];
}

export interface OnboardingPrompt {
  text: string;
  category: string;
}

export type OnboardingStep =
  | 'brand'
  | 'describe'
  | 'competitors'
  | 'prompts'
  | 'report';

// The resumable wizard state served by GET /onboarding. Competitors/prompts are
// editable drafts here until `commit` materialises them as entities/prompts.
export interface OnboardingState {
  onboardingCompleted: boolean;
  // The drafts are materialised and the onboard runs fired; the user is on the
  // live report but hasn't left it yet.
  committed: boolean;
  step: OnboardingStep;
  surfaces: string[];
  brand: {
    id: number;
    name: string;
    domains: string[];
    aliases: EntityAlias[];
  } | null;
  profile: {
    description: string;
    summary: string;
    targetMarket: string;
    logoUrl: string;
    siteMetadata: SiteMetadata | null;
    competitors: OnboardingCompetitor[];
    prompts: OnboardingPrompt[];
  };
  regenLimit: number;
  regen: { describe: number; competitors: number; prompts: number };
}

export interface ChatListItem {
  id: number;
  title: string;
  updatedAt: number;
}

export interface ChatStep {
  label: string;
  detail?: string;
}

export interface ChatWebSource {
  title: string;
  url: string;
  num?: number;
}

// Agent write drafts: shown as a confirmation card, applied only by a human.
export type ChatProposal =
  | {
      kind: 'prompts';
      items: { text: string; category?: string }[];
      status: 'pending' | 'applied' | 'dismissed';
      summary?: string;
    }
  | {
      kind: 'competitor';
      name: string;
      domains: string[];
      aliases: EntityAlias[];
      status: 'pending' | 'applied' | 'dismissed';
      summary?: string;
    };

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  // Digest-section keys + the data frozen at answer time; the client renders
  // panels from panelData so old conversations keep their original numbers.
  panels: string[] | null;
  panelData: Record<string, unknown> | null;
  links: { label: string; to: string }[] | null;
  // The honest work trace behind the answer + total exchange duration.
  steps: ChatStep[] | null;
  durationMs: number | null;
  proposal: ChatProposal | null;
  sources: ChatWebSource[] | null;
  createdAt: number;
}

// A chip shows `label` (short, with the number that earns the click) and
// sends `question` (the same fact in full, so the agent starts from the
// evidence). `kind` names the family it was ranked from.
export interface ChatSuggestion {
  kind: string;
  label: string;
  question: string;
}

export interface ChatSuggestions {
  name: string;
  brand: string | null;
  suggestions: ChatSuggestion[];
}

export interface RunResultRow {
  id: number;
  promptId: number;
  promptText: string;
  surface: string;
  sample: number;
  provider: string;
  ok: boolean;
  answerPresent: boolean;
  totalUrls: number;
  error: string | null;
  durationMs: number | null;
  hasRaw: number;
  brandMentioned: number;
  brandCited: number;
  brandSentiment: 'positive' | 'neutral' | 'negative' | null;
}
