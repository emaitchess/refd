import { configure } from 'onedollarstats';

const configuredHostname = import.meta.env.PUBLIC_ANALYTICS_HOSTNAME?.trim();

export const analyticsEnabled = (
  currentHostname: string,
  analyticsHostname: string | undefined,
) => Boolean(analyticsHostname && currentHostname === analyticsHostname.trim());

export const startAnalytics = () => {
  if (
    typeof window === 'undefined' ||
    !analyticsEnabled(window.location.hostname, configuredHostname)
  ) {
    return;
  }

  configure({
    hostname: configuredHostname,
    autocollect: true,
  });
};
