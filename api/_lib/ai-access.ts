import { checkAccess } from './auth.js'
import { error } from './http.js'
import { clientIp, hitCount, rateLimit } from './rate-limit.js'

/**
 * Accès aux fonctions IA (chaque appel est facturé sur la clé Anthropic du déploiement) :
 * - avec le code d'accès (la famille) : sans quota, avec seulement des garde-fous contre une fuite du code ;
 * - sans code : un petit quota gratuit par appareil et par jour, plus un plafond quotidien commun à tous les
 *   utilisateurs gratuits, qui borne la dépense même si les quotas individuels sont contournés.
 */

export interface AiLimits {
  /** Libellé au pluriel pour les messages (« analyses »). */
  label: string
  /** Avec code : appels par adresse IP et par heure, puis par jour pour tout le déploiement. */
  perIpHour: number
  perDay: number
  /** Sans code : appels gratuits par appareil et par jour. */
  freePerDevice: number
  /** Sans code : appels gratuits par jour pour l'ensemble des utilisateurs gratuits. */
  freePerDay: number
}

export interface AiGrant {
  model: string
  /** Quota restant aujourd'hui pour cet appareil ; absent avec un code d'accès. */
  quota?: { remaining: number; limit: number }
}

const MODEL = process.env.SILLAGE_MODEL || 'claude-opus-5-5'
/** Modèle de l'offre gratuite ; par défaut le même. Un modèle moins cher divise le coût de l'offre gratuite. */
const FREE_MODEL = process.env.SILLAGE_FREE_MODEL || MODEL

/** Plusieurs appareils peuvent partager une adresse IP (la box de la maison). */
const DEVICES_PER_IP = 3
const DEVICE_RE = /^[A-Za-z0-9_-]{8,64}$/
const DAY = 24 * 3600

export async function aiAccess(request: Request, kind: string, limits: AiLimits): Promise<AiGrant | Response> {
  const ip = clientIp(request)

  if (request.headers.get('x-sillage-code')) {
    const denied = await checkAccess(request)
    if (denied) return denied
    if (!(await rateLimit(`${kind}:${ip}`, limits.perIpHour, 3600))) return error(429, 'Trop de demandes, réessayez dans une heure')
    if (!(await rateLimit(kind, limits.perDay, DAY))) return error(429, 'Limite quotidienne atteinte, réessayez demain')
    return { model: MODEL }
  }

  // Compteurs du jour (UTC) : ils repartent de zéro chaque nuit.
  const day = new Date().toISOString().slice(0, 10)
  const device = request.headers.get('x-sillage-device') ?? ''
  const deviceKey = `free-${kind}:dev:${DEVICE_RE.test(device) ? device : `ip-${ip}`}:${day}`
  const tooMany = () =>
    error(429, `Vous avez utilisé vos ${limits.freePerDevice} ${limits.label} gratuites d’aujourd’hui. Revenez demain, ou entrez un code d’accès dans les réglages.`)

  if ((await hitCount(deviceKey)) >= limits.freePerDevice) return tooMany()
  if (!(await rateLimit(`free-${kind}:ip:${ip}:${day}`, limits.freePerDevice * DEVICES_PER_IP, DAY))) return tooMany()
  if (!(await rateLimit(`free-${kind}:${day}`, limits.freePerDay, DAY)))
    return error(429, `Les ${limits.label} gratuites du jour sont épuisées. Revenez demain.`)
  await rateLimit(deviceKey, limits.freePerDevice, DAY)

  return { model: FREE_MODEL, quota: { remaining: Math.max(0, limits.freePerDevice - (await hitCount(deviceKey))), limit: limits.freePerDevice } }
}

/** Relance automatique sur un autre modèle en cas de refus d'un filtre de sécurité (pas proposée pour Haiku). */
export const refusalFallback = (model: string) =>
  model.startsWith('claude-haiku') ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
