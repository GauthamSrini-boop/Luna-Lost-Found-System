import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the Vite dev server (5173) proxies API and upload requests to Express (3000),
// so the browser sees a single origin and the session cookie works without CORS.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/uploads': 'http://localhost:3000',
    },
  },
  build: { outDir: 'dist', sourcemap: false },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.js'],
    include: ['tests/components/**/*.test.{js,jsx}'],
  },
});
