import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // apps/dashboard/public: the dashboard Worker's own noindex assets (robots,
  // _headers, favicons). The public site's SEO assets live with the web Worker.
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // Local HTTPS domains fronted by Caddy (see Caddyfile).
    allowedHosts: ['refdlocal.io', 'dash.refdlocal.io'],
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
});
