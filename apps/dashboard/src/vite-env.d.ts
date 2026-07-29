/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Absolute API Worker origin (e.g. https://api.refd.ai), baked in per env
  // (apps/dashboard/.env.*).
  readonly VITE_API_ORIGIN?: string;
  // The public website origin the dashboard links back to (e.g. https://refd.ai).
  readonly VITE_PUBLIC_SITE_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
