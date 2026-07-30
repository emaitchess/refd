import {
  ANALYTICS_TAGS,
  type AnalyticsConfig,
  startAnalytics as start,
} from '@refd/core/analytics';

export { ANALYTICS_EVENTS, trackEvent } from '@refd/core/analytics';

interface AnalyticsEnv {
  websiteId?: string;
  hostUrl?: string;
  analyticsHostname?: string;
  publicSiteOrigin?: string;
}

// Mirrors the public site's gate: a build missing any value emits no tracker, so
// a self-hosted dashboard never reports to refd. `domains` also covers the
// public hostname because both share one umami website — the activation funnel
// joins its steps inside a single website id.
export const analyticsConfig = (env: AnalyticsEnv): AnalyticsConfig | null => {
  if (!env.websiteId || !env.hostUrl || !env.analyticsHostname) {
    return null;
  }
  let publicHostname: string;
  try {
    publicHostname = new URL(env.publicSiteOrigin ?? '').hostname;
  } catch {
    return null;
  }
  return {
    hostUrl: env.hostUrl,
    websiteId: env.websiteId,
    tag: ANALYTICS_TAGS.app,
    domains: [publicHostname, env.analyticsHostname],
    // Dashboard query strings carry user text (`/home?ask=`) and view filters.
    excludeSearch: true,
  };
};

export const startAnalytics = () => {
  start(
    analyticsConfig({
      websiteId: import.meta.env.VITE_UMAMI_WEBSITE_ID?.trim(),
      hostUrl: import.meta.env.VITE_UMAMI_HOST_URL?.trim(),
      analyticsHostname: import.meta.env.VITE_ANALYTICS_HOSTNAME?.trim(),
      publicSiteOrigin: import.meta.env.VITE_PUBLIC_SITE_ORIGIN,
    }),
  );
};
