import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

const crossOriginHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

const useHttps = process.env.VITE_HTTPS === 'true';

export default defineConfig({
  plugins: useHttps ? [basicSsl()] : [],
  // AudioWorklet requires cross-origin isolation headers.
  server:  { headers: crossOriginHeaders },
  preview: { headers: crossOriginHeaders },
});
