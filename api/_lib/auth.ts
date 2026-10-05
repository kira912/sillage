import { createHash, timingSafeEqual } from 'node:crypto'
import { error } from './http.js'
import { clientIp, hitCount, rateLimit } from './rate-limit.js'

/** Échecs de code d'accès tolérés par adresse IP et par fenêtre, avant blocage (contre la force brute). */
const MAX_AUTH_FAILURES = 10
const AUTH_WINDOW_SECONDS = 15 * 60

function safeEqual(a: string, b: string) {
  // Comparaison à temps constant sur des empreintes de même longueur.
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

/**
 * L'IA et les rappels sont protégés par un code d'accès partagé (SILLAGE_ACCESS_CODE),
 * saisi une fois dans les réglages du téléphone. Sans lui, n'importe qui connaissant l'URL
 * pourrait consommer le crédit API. Les échecs sont comptés par adresse IP : au-delà de
 * MAX_AUTH_FAILURES, l'adresse est bloquée pendant la fenêtre, même avec le bon code.
 */
export async function checkAccess(request: Request): Promise<Response | null> {
  const expected = process.env.SILLAGE_ACCESS_CODE
  if (!expected) return error(503, 'SILLAGE_ACCESS_CODE non configuré sur le serveur')
  const failures = `auth-fail:${clientIp(request)}`
  if ((await hitCount(failures)) >= MAX_AUTH_FAILURES) return error(429, 'Trop de tentatives, réessayez dans 15 minutes')
  const given = request.headers.get('x-sillage-code') ?? ''
  if (!given || !safeEqual(given, expected)) {
    await rateLimit(failures, MAX_AUTH_FAILURES, AUTH_WINDOW_SECONDS)
    return error(401, 'Code d’accès invalide')
  }
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
