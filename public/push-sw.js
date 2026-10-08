// Importé par le service worker généré (Workbox) : affichage des notifications push.
//
// Deux sortes de notifications :
// - un rappel, dont le texte est prêt à afficher ;
// - une note ajoutée par un autre membre de l'espace partagé : le serveur transmet un résumé chiffré qu'on
//   déchiffre ici avec la clé de l'espace, rangée par l'app dans la base `sillage-push` (voir src/lib/space-push.ts).

const KV_DB = 'sillage-push'
const KV_STORE = 'kv'

function kv(mode, run) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(KV_DB, 1)
    open.onupgradeneeded = () => open.result.createObjectStore(KV_STORE)
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const tx = db.transaction(KV_STORE, mode)
      const req = run(tx.objectStore(KV_STORE))
      tx.oncomplete = () => {
        db.close()
        resolve(req.result)
      }
      tx.onerror = () => reject(tx.error)
    }
  })
}
const kvGet = (key) => kv('readonly', (s) => s.get(key))
const kvPut = (key, value) => kv('readwrite', (s) => s.put(value, key))

function fromBase64Url(s) {
  const padded = (s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
}

async function decryptNotice(space, blob) {
  const key = await kvGet(`space-key:${space}`)
  if (!key) return null
  const bytes = fromBase64Url(blob)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12))
  return JSON.parse(new TextDecoder().decode(plain))
}

/** « aujourd'hui à 14:30 », « demain », « jeudi 9 octobre ». */
function describeDay(date, time) {
  const [y, m, d] = date.split('-').map(Number)
  const day = new Date(y, m - 1, d)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = Math.round((day - today) / 86_400_000)
  const label =
    diff === 0 ? 'aujourd’hui' : diff === 1 ? 'demain' : new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(day)
  return time ? `${label} à ${time}` : label
}

async function showSpaceNotice(data) {
  const notice = await decryptNotice(data.space, data.notice).catch(() => null)
  const items = Array.isArray(notice?.items) ? notice.items : []
  const count = Number(notice?.count) || items.length || 1
  const by = typeof notice?.by === 'string' && notice.by ? notice.by : 'Quelqu’un'

  let title = 'Nouvelle note dans l’espace partagé'
  let body = ''
  if (notice && count === 1 && items[0]) {
    const item = items[0]
    title = item.date ? `${by} a ajouté à l’agenda` : `${by} a ajouté une note`
    body = [item.title || 'Sans titre', item.date ? describeDay(item.date, item.time) : ''].filter(Boolean).join(', ')
  } else if (notice) {
    title = `${by} a ajouté ${count} notes`
    body = items.map((i) => i.title || 'Sans titre').join(', ') + (count > items.length ? '…' : '')
  }

  // Pastille de l'icône : le nombre connu de l'app, plus ce qui arrive (l'app le corrige à sa prochaine ouverture).
  const badge = ((await kvGet('badge').catch(() => 0)) || 0) + count
  await kvPut('badge', badge).catch(() => {})
  await self.navigator.setAppBadge?.(badge).catch?.(() => {})

  const tab = items.some((i) => i.date) ? 'agenda' : 'notes'
  await self.registration.showNotification(title, {
    body,
    tag: data.tag,
    icon: '/pwa-192.png',
    badge: '/pwa-192.png',
    data: { tab },
  })
}

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }
  if (data.kind === 'space') {
    event.waitUntil(showSpaceNotice(data))
    return
  }
  const title = data.title || 'Sillage'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      tag: data.tag,
      icon: '/pwa-192.png',
      badge: '/pwa-192.png',
      data: {},
    }),
  )
})

// Toucher la notification ouvre l'app sur l'onglet concerné (Notes ou Agenda).
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const tab = event.notification.data?.tab
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const existing = windows.find((w) => 'focus' in w)
      if (existing) {
        if (tab) existing.postMessage({ type: 'sillage:open-tab', tab })
        return existing.focus()
      }
      return self.clients.openWindow(tab ? `/app/#onglet=${tab}` : '/app/')
    }),
  )
})
