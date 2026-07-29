// The dashboard app lives on its own origin; public-site CTAs link across to it.
// Set per environment in apps/web/.env.development / .env.production.
export const DASHBOARD_ORIGIN =
  import.meta.env.PUBLIC_DASHBOARD_ORIGIN ?? 'https://dash.refd.ai';
export const SIGN_IN_URL = `${DASHBOARD_ORIGIN}/auth/sign-in`;
export const CREATE_ACCOUNT_URL = `${DASHBOARD_ORIGIN}/auth/create-account`;
export const DASHBOARD_HOME_URL = `${DASHBOARD_ORIGIN}/home`;
export const GITHUB_URL = 'https://github.com/emaitchess/refd';
