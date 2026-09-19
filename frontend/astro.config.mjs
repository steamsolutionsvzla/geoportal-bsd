// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://tu-dominio.com',
  base: '/',
  trailingSlash: 'ignore',
  build: {
    format: 'directory',
  },
  vite: {
    server: {
      watch: {
        ignored: ['**/public/**'],
      },
      // 👇 Reenvía /api/* al backend en el puerto 8000
      proxy: {
        '/api': {
          target: 'http://localhost:8000',
          changeOrigin: true,
        },
      },
    },
    optimizeDeps: {
      exclude: ['maplibre-gl'],
    },
    worker: {
      format: 'es',
    },
  },
});