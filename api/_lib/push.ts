import webpush, { WebPushError, type PushSubscription } from 'web-push'

let configured = false

export const vapidPublicKey = () => process.env.VAPID_PUBLIC_KEY ?? null

export const pushConfigured = () =>
  !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT)

/** Rappel (texte prêt à afficher) ou note ajoutée dans un espace (résumé chiffré, déchiffré par le téléphone). */
export type PushPayload = { title: string; body: string; tag?: string } | { kind: 'space'; space: string; notice: string; tag: string }

/** Renvoie `gone` si l'abonnement n'existe plus (app désinstallée, notifications retirées). */
export async function sendPush(subscription: PushSubscription, payload: PushPayload): Promise<'sent' | 'gone'> {
  if (!configured) {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT!, process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!)
    configured = true
  }
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: 3600, urgency: 'high' })
    return 'sent'
  } catch (e) {
    if (e instanceof WebPushError && (e.statusCode === 404 || e.statusCode === 410)) return 'gone'
    throw e
  }
}

export function isSubscription(v: unknown): v is PushSubscription {
  const s = v as PushSubscription
  return (
    !!s &&
    typeof s.endpoint === 'string' &&
    s.endpoint.startsWith('https://') &&
    typeof s.keys?.p256dh === 'string' &&
    typeof s.keys?.auth === 'string'
  )
}
