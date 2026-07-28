import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';

// `Env` comes from worker-configuration.d.ts (bunx wrangler types).
// Secrets aren't inferable from config — declared here on top.
export type AppEnv = Omit<Env, 'PUBLIC_BASE_URL'> & {
  // Added by OAuthProvider before it delegates to the protected/default handler.
  OAUTH_PROVIDER?: OAuthHelpers;
  // Comma-separated operator allowlist. Authorization fails closed when absent.
  ADMIN_EMAILS?: string;
  BRIGHTDATA_API_TOKEN: string;
  // Optional notify callback config. Both values must be present for webhook
  // delivery; self-hosted/local environments without them keep polling.
  BRIGHTDATA_WEBHOOK_SECRET?: string;
  PUBLIC_BASE_URL?: string;
  JWT_SECRET: string;
  // Exa company search — competitor discovery (onboarding). Optional: without
  // it the competitors step soft-fails to manual entry.
  EXA_API_KEY: string;
};

export type AppBindings = { Bindings: AppEnv };
