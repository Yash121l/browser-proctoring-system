import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite config with CSP-friendly defaults (nonce to be added by server in prod)
export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: true
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/auth': 'http://localhost:3000',
      '/presign': 'http://localhost:3000',
      '/events': 'http://localhost:3000',
      '/api': 'http://localhost:3000',
      '/admin': 'http://localhost:3000',
      '/socket.io': {
        target: 'ws://localhost:3000',
        ws: true
      }
    }
  }
});
