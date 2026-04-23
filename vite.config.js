import { defineConfig } from 'vite';

const crossOriginHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  // AudioWorklet requires cross-origin isolation headers.
  server:  { headers: crossOriginHeaders },
  preview: { headers: crossOriginHeaders },
});
