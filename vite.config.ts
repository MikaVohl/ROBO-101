import { defineConfig } from 'vitest/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'web',
  plugins: [
    react(),
    {
      name: 'pyodide-runtime',
      configureServer(server) {
        // Pyodide's dynamic imports must bypass Vite's public-module transform.
        // These two pinned files resolve their own WASM/stdlib alongside them.
        server.middlewares.use('/vendor/pyodide', (request, response, next) => {
          const file = request.url?.split('?')[0];
          if (file !== '/pyodide.mjs' && file !== '/pyodide.asm.mjs') return next();
          void readFile(resolve('web/public/vendor/pyodide', file.slice(1)))
            .then((data) => {
              response.setHeader('Content-Type', 'text/javascript');
              response.end(data);
            })
            .catch(next);
        });
      },
    },
  ],
  build: { outDir: '../src/robo_101/web', emptyOutDir: true },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:8000', ws: true, changeOrigin: true, rewriteWsOrigin: true },
      '/health': { target: 'http://127.0.0.1:8000' },
    },
  },
  worker: { format: 'es' },
  test: { include: ['tests/**/*.test.ts'] },
});
