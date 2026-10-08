import react from '@vitejs/plugin-react'
import type { IncomingMessage } from 'node:http'
import { createServer, defineConfig, loadEnv, type Connect, type Plugin, type ViteDevServer } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Exécute les fonctions de `api/` (format Vercel : `export function POST(request)`) dans le serveur
 * Vite, avec les variables de `.env.local` : en dev (`pnpm dev`) comme en préproduction locale
 * (`pnpm build && pnpm preview`). En production, c'est Vercel qui s'en charge.
 */
function apiServer(): Plugin {
  const readBody = (req: IncomingMessage) =>
    new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => resolve(Buffer.concat(chunks)))
      req.on('error', reject)
    })

  const middleware =
    (load: (path: string) => Promise<Record<string, unknown>>): Connect.NextHandleFunction =>
    async (req, res, next) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const route = url.pathname.match(/^\/api\/([a-z-]+)$/)?.[1]
      if (!route) return next()
      try {
        const mod = await load(`/api/${route}.ts`).catch(() => null)
        if (!mod) return void ((res.statusCode = 404), res.end())
        const handler = mod[req.method ?? 'GET']
        if (typeof handler !== 'function') return void ((res.statusCode = 405), res.end())
        const headers = new Headers()
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
        const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
        const response: Response = await handler(
          new Request(url, { method: req.method, headers, body: hasBody ? new Uint8Array(await readBody(req)) : undefined }),
        )
        res.statusCode = response.status
        response.headers.forEach((v, k) => res.setHeader(k, v))
        res.end(Buffer.from(await response.arrayBuffer()))
      } catch (e) {
        next(e)
      }
    }

  return {
    name: 'sillage-api',
    configResolved(config) {
      Object.assign(process.env, loadEnv(config.mode, process.cwd(), ''))
    },
    configureServer(server) {
      server.middlewares.use(middleware((path) => server.ssrLoadModule(path)))
    },
    configurePreviewServer(server) {
      // Le serveur de preview ne sait pas charger du TypeScript : un Vite minimal s'en charge à la demande.
      let loader: ViteDevServer | undefined
      server.middlewares.use(
        middleware(async (path) => {
          loader ??= await createServer({
            configFile: false,
            appType: 'custom',
            optimizeDeps: { noDiscovery: true },
            server: { middlewareMode: true, hmr: false },
          })
          return loader.ssrLoadModule(path)
        }),
      )
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  // Écoute sur le réseau local pour tester depuis le téléphone (http://<ip-du-pc>:5173).
  // allowedHosts : autorise un tunnel HTTPS (cloudflared) pour tester l'installation de la PWA.
  server: { host: true, allowedHosts: ['.trycloudflare.com'] },
  preview: { host: true },
  plugins: [
    react(),
    apiServer(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      workbox: {
        // La police des titres fait partie de l'app : elle doit être là hors ligne.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Gestion des notifications push dans le service worker généré.
        importScripts: ['push-sw.js'],
        navigateFallbackDenylist: [/^\/api\//],
      },
      manifest: {
        name: 'Sillage — notes & agenda',
        short_name: 'Sillage',
        description: 'Notes, listes et rendez-vous, même hors ligne.',
        lang: 'fr',
        id: '/',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f7f5f6',
        theme_color: '#f7f5f6',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
