import { defineConfig } from 'vite';

export default defineConfig({
  // Serve with the headers AudioWorklet needs for SharedArrayBuffer /
  // cross-origin isolation (good practice even without SAB).
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
