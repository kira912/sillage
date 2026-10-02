import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // Écoute sur le réseau local pour tester depuis le téléphone (http://<ip-du-pc>:5173).
  // allowedHosts : autorise un tunnel HTTPS (cloudflared) pour tester l'installation de la PWA.
  server: { host: true, allowedHosts: ['.trycloudflare.com'] },
  preview: { host: true },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Sillage — notes & agenda',
        short_name: 'Sillage',
        description: 'Notes, listes et rendez-vous, même hors ligne.',
        lang: 'fr',
        id: '/',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f6f3ee',
        theme_color: '#f6f3ee',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
