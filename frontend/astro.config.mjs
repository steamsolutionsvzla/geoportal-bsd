// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  // Dominio real del geoportal (canonical URLs / sitemap).
  site: 'https://geobsd.steamsolutions.tech',
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
      proxy: {
        '/api': {
          target: 'http://localhost:8000',
          changeOrigin: true,
        },
        // WMS de GeoServer (evita CORS: mismo origen que el dev server)
        '/geoserver': {
          target: 'http://localhost:8081',
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