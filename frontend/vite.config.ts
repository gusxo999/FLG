import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    port: 5173,
    // ?raw import으로 ../scripts/*.lua 같이 frontend 외부 파일을 읽을 수 있게 허용
    fs: {
      allow: ['..'],
    },
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL ?? 'http://backend:8000',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (err) => {
            console.error('[proxy error]', err.message);
          });
          proxy.on('proxyReq', (_proxyReq, req) => {
            console.log('[proxy]', req.method, req.url, '→', process.env.VITE_API_URL ?? 'http://backend:8000');
          });
        },
      },
    },
  },
})
