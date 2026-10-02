import { api, fetchConfig } from './api'
import { activeNotes } from './db'
import { computeReminders } from './reminders'

const ENABLED_KEY = 'sillage:push-enabled'

export type PushSupport = 'ok' | 'needs-install' | 'unsupported'

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true

/** Sur iPhone, les notifications web n'existent que pour une app installée sur l'écran d'accueil (iOS 16.4+). */
export function pushSupport(): PushSupport {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)
  if (ios && !isStandalone()) return 'needs-install'
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

function base64UrlToUint8Array(base64: string) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
}

async function getSubscription(create: boolean): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.ready
  const existing = await registration.pushManager.getSubscription()
  if (existing || !create) return existing
  const config = await fetchConfig()
  if (!config.push || !config.vapidPublicKey) throw new Error('Notifications non configurées sur le serveur')
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToUint8Array(config.vapidPublicKey),
  })
}

/** Envoie au serveur la liste complète des rappels à venir de cet appareil. */
export async function syncReminders(options: { test?: boolean } = {}) {
  const subscription = await getSubscription(false)
  if (!subscription) return
  const reminders = computeReminders(await activeNotes())
  await api('reminders', { method: 'PUT', body: { subscription: subscription.toJSON(), reminders, test: options.test } })
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
  const subscription = await getSubscription(false)
  if (!subscription) return
  await api('reminders', { method: 'DELETE', body: { subscription: subscription.toJSON() } }).catch(() => {})
  await subscription.unsubscribe()
}
