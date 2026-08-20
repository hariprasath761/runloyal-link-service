import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

export default defineConfig({
  root: here,
  // Served from /admin on the same origin as the API, so asset URLs must be
  // rooted there — a default '/' base would 404 every chunk behind the SPA
  // fallback and render a blank page with no console error worth reading.
  base: '/admin/',
  plugins: [react()],
  build: {
    outDir: path.join(root, 'admin-dist'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // `npm run admin:dev` proxies API calls to the Express server so the admin
    // can be developed with HMR without building.
    proxy: {
      '/api': 'http://localhost:3000',
      '/t': 'http://localhost:3000',
      '/uploads': 'http://localhost:3000',
    },
  },
});
