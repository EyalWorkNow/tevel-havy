import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { tevelSidecarPlugin } from './vite.sidecar';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
          '/ollama': {
            target: env.OLLAMA_PROXY_TARGET || 'http://127.0.0.1:11434',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/ollama/, ''),
          },
          '/gemini': {
            target: 'https://generativelanguage.googleapis.com',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/gemini/, ''),
          },
        },
      },
      plugins: [react(), tevelSidecarPlugin()],
      define: {
        'process.env.OLLAMA_BASE_URL': JSON.stringify(env.OLLAMA_BASE_URL),
        'process.env.OLLAMA_MODEL': JSON.stringify(env.OLLAMA_MODEL),
        'process.env.OLLAMA_FAST_MODEL': JSON.stringify(env.OLLAMA_FAST_MODEL),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY || ''),
        'process.env.GEMINI_MODEL': JSON.stringify(env.GEMINI_MODEL),
        'process.env.TEVEL_USE_GEMINI': JSON.stringify(env.TEVEL_USE_GEMINI || 'false'),
        'process.env.TEVEL_REASONING_TIMEOUT_MS': JSON.stringify(env.TEVEL_REASONING_TIMEOUT_MS),
        'process.env.TEVEL_FAST_QA_TIMEOUT_MS': JSON.stringify(env.TEVEL_FAST_QA_TIMEOUT_MS),
        'process.env.TEVEL_LOCAL_MODEL_ATTEMPT_TIMEOUT_MS': JSON.stringify(env.TEVEL_LOCAL_MODEL_ATTEMPT_TIMEOUT_MS),
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
