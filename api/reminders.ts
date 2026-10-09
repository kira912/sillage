import { error, guard, json, readJson } from './_lib/http.js'
import { isSubscription, pushConfigured, sendPush } from './_lib/push.js'
import { clientIp, rateLimit } from './_lib/rate-limit.js'
import { deviceId, getStore, type Reminder } from './_lib/store.js'

const MAX_REMINDERS = 500
/** Titre et description chiffrés (base64) : large pour un titre et une ligne de date et de lieu. */
const MAX_SEALED = 4000
/** Un peu plus que l'horizon du téléphone (60 jours), pour absorber les écarts d'horloge. */
const HORIZON_MS = 62 * 24 * 3600 * 1000
/** Rappels ouverts à tous : envois de listes limités par adresse IP (un téléphone en envoie à chaque modification). */
const MAX_SYNCS_PER_IP_PER_HOUR = 240

interface SyncRequest {
  subscription?: unknown
  reminders?: unknown
  test?: unknown
}

function cleanReminders(raw: unknown, now: number): Reminder[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(
      (r): r is Reminder =>
        !!r &&
        typeof r.id === 'string' &&
        typeof r.sealed === 'string' &&
        r.sealed.length <= MAX_SEALED &&
        Number.isFinite(r.at) &&
        r.at > now - 60_000 &&
        r.at < now + HORIZON_MS,
    )
    .slice(0, MAX_REMINDERS)
    .map((r) => ({ id: r.id.slice(0, 100), at: Math.round(r.at), sealed: r.sealed }))
}

/**
 * Le téléphone envoie la liste complète de ses rappels à venir ; elle remplace la précédente.
 * Les notes elles-mêmes restent sur le téléphone : seuls l'heure d'envoi et un texte chiffré transitent.
 */
export const PUT = guard(async (request: Request) => {
  if (!(await rateLimit(`reminders:${clientIp(request)}`, MAX_SYNCS_PER_IP_PER_HOUR, 3600))) return error(429, 'Trop de demandes, réessayez plus tard')
  if (!pushConfigured()) return error(503, 'Notifications non configurées sur le serveur (clés VAPID)')

  const input = await readJson<SyncRequest>(request, 256_000)
  if (!isSubscription(input?.subscription)) return error(400, 'Abonnement push invalide')

  const now = Date.now()
  const reminders = cleanReminders(input.reminders, now)
  const device = deviceId(input.subscription.endpoint)
  await getStore().replaceDevice(device, input.subscription, reminders)

  if (input.test === true) {
    const result = await sendPush(input.subscription, {
      title: 'Sillage',
      body: 'Les notifications fonctionnent 🎉',
      tag: 'sillage-test',
    })
    if (result === 'gone') return error(410, 'Abonnement expiré, réactivez les notifications')
  }

  return json({ scheduled: reminders.length })
})

/** Désactivation des notifications sur un appareil. */
export const DELETE = guard(async (request: Request) => {
  if (!(await rateLimit(`reminders:${clientIp(request)}`, MAX_SYNCS_PER_IP_PER_HOUR, 3600))) return error(429, 'Trop de demandes, réessayez plus tard')
  const input = await readJson<SyncRequest>(request)
  if (!isSubscription(input?.subscription)) return error(400, 'Abonnement push invalide')
  await getStore().removeDevice(deviceId(input.subscription.endpoint))
  return json({ ok: true })
})
