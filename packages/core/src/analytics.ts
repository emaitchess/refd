// The umami tracking contract, shared by the public site and the dashboard.
// Both report to one umami website: umami's funnel report joins its steps on
// session_id within a single website_id, and a session is keyed on
// (website, ip, user agent, salt) with no hostname component, so refd.ai and
// dash.refd.ai sessions merge on their own. Two websites would make the
// acquisition-to-activation funnel unmeasurable.

export const ANALYTICS_TAGS = {
  /** The public Astro site (refd.ai). */
  web: 'web',
  /** The dashboard SPA (dash.refd.ai). */
  app: 'app',
} as const;

export type AnalyticsTag = (typeof ANALYTICS_TAGS)[keyof typeof ANALYTICS_TAGS];

// umami caps event names at 50 characters.
export const ANALYTICS_EVENTS = {
  demoExplored: 'demo_explored',
  signupClick: 'signup_click',
  signupCompleted: 'signup_completed',
  signinCompleted: 'signin_completed',
  onboardingStep: 'onboarding_step',
  onboardingAiResult: 'onboarding_ai_result',
  onboardingRegenerate: 'onboarding_regenerate',
  onboardingCommitted: 'onboarding_committed',
  firstReportViewed: 'first_report_viewed',
  onboardingCompleted: 'onboarding_completed',
  evidenceOpened: 'evidence_opened',
  chatMessageSent: 'chat_message_sent',
} as const;

export type AnalyticsEvent =
  (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

export interface FunnelStep {
  /** Matches umami's own step types: a URL path, or a custom event name. */
  type: 'path' | 'event';
  value: string;
  label: string;
}

// The activation funnel from GTM.md section 15, in the exact shape the umami
// funnel report expects. Recreate it in the umami UI step for step. Steps 4-7
// are the four conditions GTM.md uses to call a workspace "activated".
export const ACTIVATION_FUNNEL: FunnelStep[] = [
  { type: 'path', value: '/', label: 'Landed on refd.ai' },
  {
    type: 'event',
    value: ANALYTICS_EVENTS.signupClick,
    label: 'Clicked a create-account CTA',
  },
  {
    type: 'event',
    value: ANALYTICS_EVENTS.signupCompleted,
    label: 'Created an account',
  },
  {
    type: 'event',
    value: ANALYTICS_EVENTS.onboardingCommitted,
    label: 'Approved the prompt plan',
  },
  {
    type: 'event',
    value: ANALYTICS_EVENTS.firstReportViewed,
    label: 'Saw the first report',
  },
  {
    type: 'event',
    value: ANALYTICS_EVENTS.onboardingCompleted,
    label: 'Entered the dashboard',
  },
  {
    type: 'event',
    value: ANALYTICS_EVENTS.evidenceOpened,
    label: 'Opened an answer',
  },
];

// umami's window is the maximum minutes allowed between consecutive steps.
// Onboarding waits on a live provider run, so a short window drops real
// conversions before the report ever renders.
export const ACTIVATION_FUNNEL_WINDOW_MINUTES = 120;

// Dashboard record ids are autoincrement integers, so a numeric path segment is
// always an id. Collapsing them keeps run, chat, and any future record ids out
// of the analytics host, which sees URLs but never workspace content.
export const sanitizeAnalyticsPath = (path: string): string =>
  path
    .split('/')
    .map((segment) => (/^\d+$/.test(segment) ? ':id' : segment))
    .join('/');

export interface AnalyticsConfig {
  /** Origin of the umami instance, e.g. https://analytics.tunnl.xyz. */
  hostUrl: string;
  websiteId: string;
  tag: AnalyticsTag;
  /** Hostnames umami collects from. Anything else is dropped in the browser. */
  domains: string[];
  /** Drop query strings before sending. The dashboard uses this; ?ask= carries user text. */
  excludeSearch?: boolean;
}

interface UmamiPayload {
  url?: string;
  referrer?: string;
  [key: string]: unknown;
}

const BEFORE_SEND_HOOK = '__refdAnalyticsBeforeSend';

// umami resolves data-before-send against `window` by name, so the hook has to
// exist before the script runs.
const sanitizePayload = (payload: UmamiPayload): UmamiPayload => {
  const next = { ...payload };
  if (typeof next.url === 'string') {
    const [path, ...rest] = next.url.split('?');
    const query = rest.join('?');
    next.url = sanitizeAnalyticsPath(path ?? '') + (query ? `?${query}` : '');
  }
  return next;
};

export const startAnalytics = (config: AnalyticsConfig | null): boolean => {
  if (!config?.websiteId || typeof document === 'undefined') {
    return false;
  }

  const globals = window as unknown as Record<string, unknown>;
  globals[BEFORE_SEND_HOOK] = (_type: string, payload: UmamiPayload) =>
    sanitizePayload(payload);

  const script = document.createElement('script');
  script.src = `${config.hostUrl.replace(/\/$/, '')}/script.js`;
  script.defer = true;
  script.dataset.websiteId = config.websiteId;
  script.dataset.tag = config.tag;
  script.dataset.domains = config.domains.join(',');
  script.dataset.beforeSend = BEFORE_SEND_HOOK;
  if (config.excludeSearch) {
    script.dataset.excludeSearch = 'true';
  }
  document.head.appendChild(script);
  return true;
};

interface Umami {
  track: (name: string, data?: Record<string, unknown>) => void;
}

// A no-op wherever analytics never loaded: server rendering, self-hosted
// deployments, local dev, and any hostname outside `domains`.
export const trackEvent = (
  name: AnalyticsEvent,
  data?: Record<string, unknown>,
): void => {
  if (typeof window === 'undefined') {
    return;
  }
  (window as unknown as { umami?: Umami }).umami?.track(name, data);
};
