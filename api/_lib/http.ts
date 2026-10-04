import { createHash, timingSafeEqual } from 'node:crypto'

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })

export const error = (status: number, message: string) => json({ error: message }, status)

/** Configuration serveur manquante ou invalide : renvoyée en 503 avec un message explicite. */
export class ConfigError extends Error {}

type Handler = (request: Request) => Promise<Response> | Response

/** Transforme toute exception en réponse JSON lisible (au lieu d'un « Internal Server Error » opaque). */
export function guard(handler: Handler): Handler {
  return async (request) => {
    try {
      return await handler(request)
    } catch (e) {
      console.error('[sillage]', e)
      if (e instanceof ConfigError) return error(503, e.message)
      return error(500, `Erreur serveur : ${e instanceof Error ? e.message : String(e)}`)
    }
  }
}

function safeEqual(a: string, b: string) {
  // Comparaison à temps constant sur des empreintes de même longueur.
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

/**
 * L'IA et les rappels sont protégés par un code d'accès partagé (SILLAGE_ACCESS_CODE),
 * saisi une fois dans les réglages du téléphone. Sans lui, n'importe qui connaissant l'URL
 * pourrait consommer le crédit API.
 */
export function checkAccess(request: Request): Response | null {
  const expected = process.env.SILLAGE_ACCESS_CODE
  if (!expected) return error(503, 'SILLAGE_ACCESS_CODE non configuré sur le serveur')
  const given = request.headers.get('x-sillage-code') ?? ''
  if (!given || !safeEqual(given, expected)) return error(401, 'Code d’accès invalide')
  return null
}

/** Le cron s'authentifie avec `Authorization: Bearer <CRON_SECRET>` (format utilisé par Vercel Cron). */
export function checkCron(request: Request): Response | null {
  const secret = process.env.CRON_SECRET
  if (!secret) return error(503, 'CRON_SECRET non configuré sur le serveur')
  const auth = request.headers.get('authorization') ?? ''
  if (!safeEqual(auth, `Bearer ${secret}`)) return error(401, 'Non autorisé')
  return null
}

export async function readJson<T>(request: Request, maxBytes = 64_000): Promise<T | null> {
  const text = await request.text()
  if (text.length > maxBytes) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}
