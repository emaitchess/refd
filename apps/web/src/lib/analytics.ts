import {
  ANALYTICS_EVENTS,
  ANALYTICS_TAGS,
  type AnalyticsConfig,
  startAnalytics as start,
  trackEvent,
} from '@refd/core/analytics';
import { CREATE_ACCOUNT_URL, DASHBOARD_ORIGIN } from '../consts';

interface AnalyticsEnv {
  websiteId?: string;
  hostUrl?: string;
  analyticsHostname?: string;
}

// A self-hosted refd must not report to refd's analytics, so a build missing any
// of these values emits no tracker at all. The hostname additionally scopes
// collection, in case a production build is ever served from somewhere else.
export const analyticsConfig = (
  env: AnalyticsEnv,
  dashboardOrigin: string,
): AnalyticsConfig | null => {
  if (!env.websiteId || !env.hostUrl || !env.analyticsHostname) {
    return null;
  }
  let dashboardHostname: string;
  try {
    dashboardHostname = new URL(dashboardOrigin).hostname;
  } catch {
    return null;
  }
  // Both hosts belong to one umami website, so the activation funnel can follow
  // a visitor across the hop to the dashboard.
  return {
    hostUrl: env.hostUrl,
    websiteId: env.websiteId,
    tag: ANALYTICS_TAGS.web,
    domains: [env.analyticsHostname, dashboardHostname],
  };
};

// The last thing measurable on this origin before the visitor crosses to the
// dashboard. Delegated from the document so every CTA counts, including ones
// added later. umami sends with `keepalive`, so the beacon survives the
// navigation it is racing.
const trackSignupClicks = () => {
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (target.closest('a')?.href.startsWith(CREATE_ACCOUNT_URL)) {
      trackEvent(ANALYTICS_EVENTS.signupClick, {
        from: window.location.pathname,
      });
    }
  });
};

export const startAnalytics = () => {
  const config = analyticsConfig(
    {
      websiteId: import.meta.env.PUBLIC_UMAMI_WEBSITE_ID?.trim(),
      hostUrl: import.meta.env.PUBLIC_UMAMI_HOST_URL?.trim(),
      analyticsHostname: import.meta.env.PUBLIC_ANALYTICS_HOSTNAME?.trim(),
    },
    DASHBOARD_ORIGIN,
  );
  if (start(config)) {
    trackSignupClicks();
  }
};
