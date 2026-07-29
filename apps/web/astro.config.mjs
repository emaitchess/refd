import { fileURLToPath } from 'node:url';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

// The landing reuses the dashboard's React components + vendored dither-kit, so
// `@` resolves into the dashboard source (web's own code uses relative imports).
const dashboardSrc = fileURLToPath(
  new URL('../dashboard/src', import.meta.url),
);

// Static site (SSG). A small Cloudflare Worker (src/worker.ts) fronts the built
// assets for homepage Markdown negotiation; @astrojs/sitemap emits sitemap.xml.
export default defineConfig({
  site: 'https://refd.ai',
  integrations: [react(), sitemap()],
  trailingSlash: 'never',
  // Emit `agents.html` (served at `/agents`, no trailing-slash redirect) instead
  // of `agents/index.html` (served at `/agents/`), matching trailingSlash:never.
  build: { format: 'file' },
  vite: {
    plugins: [tailwindcss()],
    resolve: { alias: { '@': dashboardSrc } },
    // Caddy fronts the dev server at https://refdlocal.io (see Caddyfile).
    server: { allowedHosts: ['refdlocal.io'] },
  },
});
