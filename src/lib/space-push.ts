import { fromBase64Url } from './space-crypto'

/*
 * Notifications « nouvelle note » de l'espace partagé, et pastille sur l'icône de l'app.
 * Le service worker affiche la notification : il a besoin de la clé de l'espace pour déchiffrer le résumé envoyé
 * par le téléphone de l'auteur. Elle est rangée dans une petite base IndexedDB qu'il sait lire (`sillage-push`),
 * avec le nombre affiché sur l'icône (qu'il augmente à chaque notification reçue).
 */

const FLAG_KEY = 'sillage:space-push'
const DB_NAME = 'sillage-push'
const STORE = 'kv'

export const spaceKeyId = (spaceId: string) => `space-key:${spaceId}`
export const BADGE_KEY = 'badge'

function openKv(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function kv(mode: IDBTransactionMode, run: (store: IDBObjectStore) => void): Promise<void> {
  const db = await openKv()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    run(tx.objectStore(STORE))
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

/** Clé de l'espace pour le service worker (objet CryptoKey non exportable : la clé brute n'est jamais écrite). */
export const saveSpaceKey = (spaceId: string, key: CryptoKey) => kv('readwrite', (s) => s.put(key, spaceKeyId(spaceId))).catch(() => {})
export const forgetSpaceKey = (spaceId: string) => kv('readwrite', (s) => s.delete(spaceKeyId(spaceId))).catch(() => {})

export function spacePushWanted(): boolean {
  try {
    return localStorage.getItem(FLAG_KEY) === '1' && typeof Notification !== 'undefined' && Notification.permission === 'granted'
  } catch {
    return false
  }
}

export function setSpacePushWanted(on: boolean) {
  try {
    if (on) localStorage.setItem(FLAG_KEY, '1')
    else localStorage.removeItem(FLAG_KEY)
  } catch {
    /* ignoré : le réglage sera redemandé */
  }
}

/** Abonnement push de ce téléphone (partagé avec les rappels), créé au besoin avec la clé publique donnée. */
export async function pushSubscription(create?: { vapidKey: string }): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator)) return null
  const registration = await navigator.serviceWorker.ready
  const existing = await registration.pushManager.getSubscription()
  if (existing || !create) return existing
  return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromBase64Url(create.vapidKey) })
}

/** Nombre sur l'icône de l'app (écran d'accueil) ; le service worker part de ce nombre à la prochaine notification. */
export async function setAppBadge(count: number) {
  await kv('readwrite', (s) => s.put(count, BADGE_KEY)).catch(() => {})
  try {
    if (count > 0) await navigator.setAppBadge?.(count)
    else await navigator.clearAppBadge?.()
  } catch {
    /* pastille non prise en charge (navigateur, app non installée) */
  }
}
