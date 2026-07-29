/// <reference types="astro/client" />

interface ImportMetaEnv {
  // The dashboard app origin the landing links to. Set per environment in
  // apps/web/.env.development / .env.production.
  readonly PUBLIC_DASHBOARD_ORIGIN?: string;
  readonly PUBLIC_ANALYTICS_HOSTNAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
