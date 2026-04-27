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
        },
      },
      plugins: [react(), tevelSidecarPlugin()],
      define: {
        'process.env.OLLAMA_BASE_URL': JSON.stringify(env.OLLAMA_BASE_URL),
        'process.env.OLLAMA_MODEL': JSON.stringify(env.OLLAMA_MODEL),
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
