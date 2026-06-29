import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Base relativa para funcionar tanto em domínio próprio quanto em subpasta
// (ex.: GitHub Pages). Paths absolutos quebram em subpasta.
export default defineConfig({
  base: './',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Reprogramação',
        short_name: 'Reprogramação',
        description: 'Crie áudios personalizados com a sua própria voz sobre música de fundo.',
        lang: 'pt-BR',
        theme_color: '#0e1014',
        background_color: '#0e1014',
        display: 'standalone',
        start_url: './',
        scope: './',
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Áudios podem ser grandes; aumentamos o limite de cache de assets.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
});
