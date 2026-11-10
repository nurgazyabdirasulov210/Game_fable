import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/socket.io': { target: 'http://localhost:3001', ws: true },
    },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
