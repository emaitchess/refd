import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';

// `Env` comes from worker-configuration.d.ts (bunx wrangler types).
// Secrets aren't inferable from config — declared here on top.
export type AppEnv = Omit<
  Env,
  'PUBLIC_BASE_URL' | 'PUBLIC_SITE_ORIGIN' | 'DASHBOARD_ORIGIN' | 'API_ORIGIN'
> & {
  // Added by OAuthProvider before it delegates to the protected/default handler.
  OAUTH_PROVIDER?: OAuthHelpers;
  // Comma-separated operator allowlist. Authorization fails closed when absent.
  ADMIN_EMAILS?: string;
  BRIGHTDATA_API_TOKEN: string;
  // Optional notify callback config. Both values must be present for webhook
  // delivery; self-hosted/local environments without them keep polling.
  BRIGHTDATA_WEBHOOK_SECRET?: string;
  PUBLIC_BASE_URL?: string;
  // Explicit deployment origins (three-worker split). Optional: when
  // DASHBOARD_ORIGIN is unset the API behaves same-origin (the Phase 1 bridge),
  // emitting no CORS and allowing only same-origin browser mutations.
  PUBLIC_SITE_ORIGIN?: string;
  DASHBOARD_ORIGIN?: string;
  API_ORIGIN?: string;
  JWT_SECRET: string;
  // Exa company search — competitor discovery (onboarding). Optional: without
  // it the competitors step soft-fails to manual entry.
  EXA_API_KEY: string;
  // Setup spend circuit breakers (dashboard and MCP share them). Optional with
  // sane defaults; zero/negative values fall back to the defaults.
  SETUP_GENERATION_DAILY_LIMIT?: string;
  SETUP_REPORT_DAILY_LIMIT?: string;
  // Phase-gates the data:write OAuth scope and the MCP setup tools. Default
  // off; flip in wrangler vars for the bounded production test.
  MCP_SETUP_TOOLS_ENABLED?: string;
};

export type AppBindings = { Bindings: AppEnv };
