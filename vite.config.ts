import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 开发/预览时 /s/:id 回退到 index.html，供只读分享页 SPA */
function shareSpaFallbackPlugin() {
  const sendIndex = (htmlPath: string, res: any) => {
    if (!fs.existsSync(htmlPath)) return false;
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html');
    res.end(fs.readFileSync(htmlPath, 'utf-8'));
    return true;
  };
  return {
    name: 'share-spa-fallback',
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: any) => {
        const p = (req.url || '').split('?')[0];
        if (p.startsWith('/s/') && p.length > 3 && !path.extname(p)) {
          const htmlPath = path.resolve(__dirname, 'index.html');
          if (sendIndex(htmlPath, res)) return;
        }
        next();
      });
    },
    configurePreviewServer(server: any) {
      server.middlewares.use((req: any, res: any, next: any) => {
        const p = (req.url || '').split('?')[0];
        if (p.startsWith('/s/') && p.length > 3 && !path.extname(p)) {
          const distIndex = path.resolve(__dirname, 'dist/index.html');
          if (sendIndex(distIndex, res)) return;
        }
        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss(), shareSpaFallbackPlugin()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        '/api': {
          target: process.env.VITE_PROXY_TARGET || 'http://localhost:3001',
          changeOrigin: true,
        },
      },
    },
  };
});
