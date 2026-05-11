import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, the Vite server runs on :5173 and proxies /api + /healthz to a
// uvicorn backend on :8000. Set BACKEND_URL when the backend lives elsewhere.
const BACKEND = process.env.BACKEND_URL ?? 'http://localhost:8000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: BACKEND, changeOrigin: true },
      '/healthz': { target: BACKEND, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
});
