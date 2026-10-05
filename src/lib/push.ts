import { api, fetchConfig } from './api'
import { activeNotes } from './db'
import { isIos, isStandalone } from './platform'
import { computeReminders } from './reminders'
import { fromBase64Url } from './space-crypto'

const ENABLED_KEY = 'sillage:push-enabled'

export type PushSupport = 'ok' | 'needs-install' | 'unsupported'

/** Sur iPhone, les notifications web n'existent que pour une app installée sur l'écran d'accueil (iOS 16.4+). */
export function pushSupport(): PushSupport {
  if (isIos() && !isStandalone()) return 'needs-install'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported'
  return 'ok'
}

export function isPushEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === '1' && Notification.permission === 'granted'
  } catch {
    return false
  }
}

function setEnabledFlag(on: boolean) {
  try {
    if (on) localStorage.setItem(ENABLED_KEY, '1')
    else localStorage.removeItem(ENABLED_KEY)
  } catch {
    /* ignoré */
  }
}

async function getSubscription(create: boolean): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.ready
  const existing = await registration.pushManager.getSubscription()
  if (existing || !create) return existing
  const config = await fetchConfig()
  if (!config.push || !config.vapidPublicKey) throw new Error('Notifications non configurées sur le serveur')
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: fromBase64Url(config.vapidPublicKey),
  })
}

/** Dernière liste envoyée : inutile de la renvoyer si aucune note n'a changé de rappel. */
let lastSent = ''

/** Envoie au serveur la liste complète des rappels à venir de cet appareil (si elle a changé). */
export async function syncReminders(options: { test?: boolean } = {}) {
  const subscription = await getSubscription(false)
  if (!subscription) return
  const reminders = computeReminders(await activeNotes())
  const payload = JSON.stringify([subscription.endpoint, reminders])
  if (payload === lastSent && !options.test) return
  await api('reminders', { method: 'PUT', body: { subscription: subscription.toJSON(), reminders, test: options.test } })
  lastSent = payload
}

/** À appeler depuis un geste de l'utilisateur (exigence d'iOS pour la demande de permission). */
export async function enablePush() {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notifications refusées. Autorisez-les dans Réglages iPhone → Sillage.')
  await getSubscription(true)
  setEnabledFlag(true)
  await syncReminders({ test: true })
}

export async function disablePush() {
  setEnabledFlag(false)
  lastSent = ''
  const subscription = await getSubscription(false)
  if (!subscription) return
  await api('reminders', { method: 'DELETE', body: { subscription: subscription.toJSON() } }).catch(() => {})
  await subscription.unsubscribe()
}
