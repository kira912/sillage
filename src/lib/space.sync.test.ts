import Dexie from 'dexie'
import { Redis } from '@upstash/redis'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST as spaceHandler } from '../../api/space'
import { SHOPPING_ID } from './shopping'

/**
 * Synchronisation de bout en bout entre deux « téléphones » : chacun a ses propres modules (état, base
 * IndexedDB simulée) et parle au vrai gestionnaire `/api/space`. Stockage en mémoire, ou Redis si
 * SILLAGE_TEST_REDIS_URL est défini (voir api/_lib/space-store.test.ts).
 */
if (process.env.SILLAGE_TEST_REDIS_URL) {
  process.env.KV_REST_API_URL = process.env.SILLAGE_TEST_REDIS_URL
  process.env.KV_REST_API_TOKEN = process.env.SILLAGE_TEST_REDIS_TOKEN ?? ''
}

type Client = {
  space: typeof import('./space')
  db: (typeof import('./db'))['db']
  newNote: (typeof import('./db'))['newNote']
}

async function makeClient(): Promise<Client> {
  vi.resetModules()
  // Les modules de l'app sont rechargés, pas Dexie : chaque base créée ensuite utilise cette IndexedDB à part.
  Object.assign(Dexie.dependencies, { indexedDB: new IDBFactory(), IDBKeyRange })
  const [space, dbModule] = await Promise.all([import('./space'), import('./db')])
  return { space, db: dbModule.db, newNote: dbModule.newNote }
}

/** Synchronise jusqu'à ce que tout soit envoyé et reçu (les passages suivants s'enchaînent tout seuls). */
async function settle(c: Client) {
  for (let i = 0; i < 20; i++) await c.space.syncSpace()
  const error = c.space.getSpace()?.lastError
  if (error) throw new Error(error)
}

const bodyOf = async (c: Client, id: string) => (await c.db.notes.get(id))?.body

/** Adresse IP propre à chaque test : les limites anti-abus (créations d'espace par heure…) ne s'additionnent pas. */
let testIp = 0

beforeAll(() => {
  const storage = new Map<string, string>()
  const realFetch = globalThis.fetch
  Object.assign(globalThis, {
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    },
    fetch: async (url: string, init: RequestInit) => {
      // Les appels du client Redis (Upstash) passent normalement.
      if (!url.startsWith('/')) return realFetch(url, init)
      if (url !== '/api/space') throw new Error(`requête inattendue : ${url}`)
      const headers = { ...(init.headers as Record<string, string>), 'x-real-ip': `10.0.0.${testIp}` }
      return spaceHandler(new Request('http://localhost/api/space', { method: 'POST', body: init.body, headers }))
    },
  })
  Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true })
})

// Avec Redis, les limites d'appels (créations d'espace par heure…) survivent d'un lancement des tests à l'autre.
beforeEach(async () => {
  testIp++
  const url = process.env.SILLAGE_TEST_REDIS_URL
  if (!url) return
  const redis = new Redis({ url, token: process.env.SILLAGE_TEST_REDIS_TOKEN ?? '' })
  const keys = await redis.keys('sillage:rl:*')
  if (keys.length) await redis.del(...keys)
})

describe('synchronisation de l’espace partagé', () => {
  it('fusionne des cases cochées en même temps sur deux téléphones', async () => {
    const a = await makeClient()
    await a.space.createSpace('Famille', 'Alice')
    const list = a.newNote({ title: 'Courses', body: '- [ ] lait\n- [ ] pain\n- [ ] œufs', shared: true })
    await a.db.notes.add(list)
    await settle(a)

    const b = await makeClient()
    await b.space.joinSpace(a.space.getSpace()!.secret, 'Bob')
    await settle(b)
    expect(await bodyOf(b, list.id)).toBe(list.body)

    // Chacun coche un article différent, sans avoir vu la modification de l'autre.
    await a.db.notes.update(list.id, { body: '- [x] lait\n- [ ] pain\n- [ ] œufs', updatedAt: Date.now() })
    await b.db.notes.update(list.id, { body: '- [ ] lait\n- [ ] pain\n- [x] œufs', updatedAt: Date.now() })
    await settle(a)
    await settle(b) // conflit côté serveur : fusion, puis renvoi
    await settle(a)

    const merged = '- [x] lait\n- [ ] pain\n- [x] œufs'
    expect(await bodyOf(a, list.id)).toBe(merged)
    expect(await bodyOf(b, list.id)).toBe(merged)
    // Aucune copie de conflit : la fusion a suffi.
    expect(await b.db.notes.count()).toBe(1)

    // Même titre réécrit des deux côtés : la version du serveur l'emporte, l'autre est gardée en copie personnelle.
    await a.db.notes.update(list.id, { title: 'Courses samedi', updatedAt: Date.now() })
    await b.db.notes.update(list.id, { title: 'Courses dimanche', updatedAt: Date.now() })
    await settle(a)
    await settle(b)
    expect((await b.db.notes.get(list.id))?.title).toBe('Courses samedi')
    const copy = (await b.db.notes.toArray()).find((n) => n.id !== list.id)
    expect(copy).toMatchObject({ title: 'Courses dimanche (version en conflit)' })
    expect(copy?.shared).toBeFalsy()
  })

  it('partage les listes de courses faites avant l’espace, en réunissant leurs articles', async () => {
    const a = await makeClient()
    // Liste gardée d'un espace quitté : explicitement non partagée.
    await a.db.notes.add(a.newNote({ id: SHOPPING_ID, title: 'Courses', body: '- [ ] lait', shared: false }))
    await a.space.createSpace('Famille', 'Alice')
    await settle(a)
    expect((await a.db.notes.get(SHOPPING_ID))?.shared).toBe(true)

    const b = await makeClient()
    await b.db.notes.add(b.newNote({ id: SHOPPING_ID, title: 'Courses', body: '- [ ] pain' }))
    await b.space.joinSpace(a.space.getSpace()!.secret, 'Bob')
    await settle(b)
    await settle(a)

    for (const c of [a, b]) {
      const list = await c.db.notes.get(SHOPPING_ID)
      expect(list?.shared).toBe(true)
      expect(list?.body.split('\n').sort()).toEqual(['- [ ] lait', '- [ ] pain'])
    }
  })

  it('signale comme nouvelles les notes ajoutées ou mises dans l’agenda par un autre membre', async () => {
    const a = await makeClient()
    await a.space.createSpace('Famille', 'Alice')
    const existing = a.newNote({ title: 'Idées vacances', shared: true })
    await a.db.notes.add(existing)
    await settle(a)

    // En rejoignant l'espace, les notes déjà là ne sont pas des nouveautés.
    const b = await makeClient()
    await b.space.joinSpace(a.space.getSpace()!.secret, 'Bob')
    await settle(b)
    expect((await b.db.notes.get(existing.id))?.unread).toBeUndefined()

    const added = a.newNote({ title: 'Pédiatre', date: '2026-10-09', shared: true })
    await a.db.notes.add(added)
    await a.db.notes.update(existing.id, { date: '2026-10-12', updatedAt: Date.now() })
    await settle(a)
    await settle(b)
    expect(await b.db.notes.get(added.id)).toMatchObject({ unread: true, editedBy: 'Alice' })
    expect((await b.db.notes.get(existing.id))?.unread).toBe(true)

    // Les notes de Bob ne sont pas des nouveautés pour lui, et Alice ne voit pas les siennes comme nouvelles.
    const own = b.newNote({ title: 'Liste cadeaux', shared: true })
    await b.db.notes.add(own)
    await settle(b)
    await settle(a)
    expect((await b.db.notes.get(own.id))?.unread).toBeUndefined()
    expect((await a.db.notes.get(own.id))?.unread).toBe(true)
    expect((await a.db.notes.get(added.id))?.unread).toBeUndefined()
  })

  it('transmet un gros espace en plusieurs envois et plusieurs pages', async () => {
    const a = await makeClient()
    await a.space.createSpace('Gros', 'Alice')
    const notes = Array.from({ length: 120 }, (_, i) => a.newNote({ title: `Note ${i}`, body: 'x'.repeat(30_000), shared: true }))
    await a.db.notes.bulkAdd(notes)
    await settle(a)

    const b = await makeClient()
    await b.space.joinSpace(a.space.getSpace()!.secret, 'Bob')
    await settle(b)
    expect(await b.db.notes.count()).toBe(120)
  })

  it('signale une note trop longue au lieu de la renvoyer indéfiniment', async () => {
    const a = await makeClient()
    await a.space.createSpace('Famille', 'Alice')
    await a.db.notes.add(a.newNote({ title: 'Roman', body: 'x'.repeat(80_000), shared: true }))
    await expect(settle(a)).rejects.toThrow('Trop longue pour être partagée : « Roman »')
  })

  it('ignore une note mal formée envoyée par un autre membre', async () => {
    const a = await makeClient()
    await a.space.createSpace('Famille', 'Alice')
    const { encryptJson, keyFor } = await import('./space-crypto')
    const s = a.space.getSpace()!
    // Un autre téléphone (version différente, ou malveillant) publie une note sans étiquettes ni texte.
    const blob = await encryptJson(await keyFor(s.secret), { note: { id: 'bad-note-1', title: 'x', tags: null }, by: 'Eve' })
    await spaceHandler(
      new Request('http://localhost/api/space', {
        method: 'POST',
        body: JSON.stringify({ action: 'sync', space: s.spaceId, member: { id: 'eve-member' }, changes: [{ id: 'bad-note-1', baseRev: 0, blob }] }),
      }),
    )
    await settle(a)
    expect(await a.db.notes.get('bad-note-1')).toBeUndefined()
  })
})
