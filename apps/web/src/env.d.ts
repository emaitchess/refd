/// <reference types="astro/client" />

interface ImportMetaEnv {
  // The dashboard app origin the landing links to. Set per environment in
  // apps/web/.env.development / .env.production.
  readonly PUBLIC_DASHBOARD_ORIGIN?: string;
  // umami analytics. All three are required before any tracker is emitted; a
  // self-hosted build leaves them unset and ships no analytics at all.
  readonly PUBLIC_ANALYTICS_HOSTNAME?: string;
  readonly PUBLIC_UMAMI_HOST_URL?: string;
  readonly PUBLIC_UMAMI_WEBSITE_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
