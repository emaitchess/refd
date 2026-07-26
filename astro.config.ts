import path from 'node:path';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://refd.ai',
  srcDir: './src/site',
  outDir: './dist/site',
  output: 'static',
  trailingSlash: 'never',
  build: {
    format: 'file',
  },
  server: {
    host: '127.0.0.1',
    port: 4321,
  },
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
    server: {
      allowedHosts: ['refdlocal.io'],
    },
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, 'src/app'),
        '@api': path.resolve(import.meta.dirname, 'src/api'),
      },
    },
  },
});
