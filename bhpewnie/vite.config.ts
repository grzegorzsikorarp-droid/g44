import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Zasada nieprzekraczalna nr 1: zero danych na zewnatrz.
// Brak analityki, brak CDN, brak fontow zewnetrznych. Wszystko z wlasnego hosta.
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['fonty/*.ttf', 'ikony/*.svg'],
      manifest: {
        name: 'BHPewnie',
        short_name: 'BHPewnie',
        description: 'Sprawdz, co Ci sie w pracy nalezy',
        lang: 'pl',
        start_url: './',
        display: 'standalone',
        background_color: '#f4f7f6',
        theme_color: '#0e6e62',
        icons: [
          { src: 'ikony/ikona-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'ikony/ikona-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        // Zasada 2: wszystko potrzebne w chwili zdarzenia jest w paczce.
        globPatterns: ['**/*.{js,css,html,ttf,svg,png,json}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        runtimeCaching: [
          {
            // Prasowka i biblioteka: jedyne polaczenia sieciowe.
            urlPattern: /\/(prasowka|biblioteka)\/.*\.json$/,
            handler: 'NetworkFirst',
            options: { cacheName: 'tresci-sieciowe', expiration: { maxEntries: 60 } },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: { target: 'es2020', sourcemap: false },
  test: {
    environment: 'node',
    include: ['testy/**/*.test.ts'],
  },
} as any)
