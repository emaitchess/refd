/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Absolute API Worker origin (e.g. https://api.refd.ai), baked in per env
  // (apps/dashboard/.env.*).
  readonly VITE_API_ORIGIN?: string;
  // The public website origin the dashboard links back to (e.g. https://refd.ai).
  readonly VITE_PUBLIC_SITE_ORIGIN?: string;
  // umami analytics. All three are required before any tracker is emitted; a
  // self-hosted build leaves them unset and ships no analytics at all.
  readonly VITE_ANALYTICS_HOSTNAME?: string;
  readonly VITE_UMAMI_HOST_URL?: string;
  readonly VITE_UMAMI_WEBSITE_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
