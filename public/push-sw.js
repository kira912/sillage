// Importé par le service worker généré (Workbox) : affichage des notifications push.

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }
  const title = data.title || 'Sillage'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      tag: data.tag,
      icon: '/pwa-192.png',
      badge: '/pwa-192.png',
      data: { url: '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const existing = windows.find((w) => 'focus' in w)
      if (existing) return existing.focus()
      return self.clients.openWindow('/')
    }),
  )
})
