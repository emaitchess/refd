import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const appHistoryFallback = (): Plugin => ({
  name: 'refd-app-history-fallback',
  configureServer: (server) => {
    server.middlewares.use(async (request, response, next) => {
      const pathname = new URL(request.url ?? '/', 'http://refdlocal.io')
        .pathname;
      if (pathname !== '/app' && !pathname.startsWith('/app/')) {
        next();
        return;
      }

      try {
        const template = await readFile(
          path.resolve(import.meta.dirname, 'index.html'),
          'utf8',
        );
        const html = await server.transformIndexHtml(pathname, template);
        response.statusCode = 200;
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(html);
      } catch (error) {
        next(error);
      }
    });
  },
});

export default defineConfig(({ command }) => ({
  base: command === 'serve' ? '/app-dev/' : '/',
  plugins: [appHistoryFallback(), react(), tailwindcss(), cloudflare()],
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
}));
