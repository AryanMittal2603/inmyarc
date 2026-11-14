import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// `npm run dev` uses `vercel dev`, which serves the Vite app and the /api functions together.
// `npm run dev:web` runs Vite alone; set API_PROXY to point /api at a running backend.
const apiProxy = process.env.API_PROXY;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: apiProxy ? { proxy: { '/api': { target: apiProxy, changeOrigin: true } } } : undefined,
});
