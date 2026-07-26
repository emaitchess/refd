import path from 'node:path';
import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  server: {
    // Local HTTPS domain fronted by Caddy (see Caddyfile).
    allowedHosts: ['refdlocal.io'],
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src/app'),
      '@api': path.resolve(import.meta.dirname, 'src/api'),
    },
  },
});
