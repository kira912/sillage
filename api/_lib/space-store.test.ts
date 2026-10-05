import { Redis } from '@upstash/redis'
import { randomBytes } from 'node:crypto'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MAX_MEMBERS, MAX_NOTES, STALE_MEMBER_MS, getSpaceStore, type SpaceStore } from './space-store.js'
import { getStore, type Store } from './store.js'

/**
 * Tests des scripts Lua contre un vrai Redis, via l'API REST d'Upstash (proxy local SRH) :
 *   SILLAGE_TEST_REDIS_URL=http://127.0.0.1:8079 SILLAGE_TEST_REDIS_TOKEN=… pnpm test
 * Sans ces variables, ils sont ignorés (voir README).
 */
const url = process.env.SILLAGE_TEST_REDIS_URL
const token = process.env.SILLAGE_TEST_REDIS_TOKEN ?? ''

describe.skipIf(!url)('stockage Redis', () => {
  let spaces: SpaceStore
  let reminders: Store
  let redis: Redis
  let space: string

  beforeAll(() => {
    process.env.KV_REST_API_URL = url
    process.env.KV_REST_API_TOKEN = token
    redis = new Redis({ url: url!, token, automaticDeserialization: false })
    spaces = getSpaceStore()
    reminders = getStore()
  })

  // Un espace neuf par test (pas de FLUSHDB : d'autres fichiers de test utilisent le même Redis en parallèle).
  beforeEach(async () => {
    space = randomBytes(32).toString('hex')
    await spaces.create(space, 'meta')
  })

  const blob = (size = 100) => 'x'.repeat(size)

  it('écrit, détecte les conflits et transmet les retraits', async () => {
    const first = await spaces.applyChange(space, 'note-0001', 0, blob())
    expect(first).toEqual({ ok: true, rev: 1 })
    expect(await spaces.applyChange(space, 'note-0001', 1, blob(120))).toEqual({ ok: true, rev: 2 })

    // Base périmée : la version actuelle est renvoyée, rien n'est écrit.
    const stale = await spaces.applyChange(space, 'note-0001', 1, blob(130))
    expect(stale).toEqual({ ok: false, current: { id: 'note-0001', rev: 2, blob: blob(120) } })

    expect(await spaces.applyChange(space, 'note-0001', 2, null)).toEqual({ ok: true, rev: 3 })
    // Un retrait est aussi une version : une base antérieure est en conflit avec lui.
    expect(await spaces.applyChange(space, 'note-0001', 2, blob())).toEqual({
      ok: false,
      current: { id: 'note-0001', rev: 3, blob: null },
    })

    const page = await spaces.changesSince(space, 0, 1_000_000)
    expect(page).toEqual({ rev: 3, more: false, entries: [{ id: 'note-0001', rev: 3, blob: null }] })
    expect(await redis.hlen(`sillage:space:${space}:notes`)).toBe(0)
  })

  it('ne compte pas les notes retirées dans la limite de notes', async () => {
    for (let i = 0; i < MAX_NOTES; i += 250) {
      await Promise.all(
        Array.from({ length: 250 }, (_, j) => spaces.applyChange(space, `note-${String(i + j).padStart(5, '0')}`, 0, blob(10))),
      )
    }
    expect(await spaces.applyChange(space, 'note-extra', 0, blob(10))).toEqual({ ok: false, full: true })

    const removed = await spaces.applyChange(space, 'note-00000', 1, null)
    expect(removed.ok).toBe(true)
    expect((await spaces.applyChange(space, 'note-extra', 0, blob(10))).ok).toBe(true)
  }, 60_000)

  it('pagine les changements par taille', async () => {
    for (let i = 0; i < 10; i++) await spaces.applyChange(space, `note-000${i}`, 0, blob(1000))

    const seen: string[] = []
    let since = 0
    for (let round = 0; round < 20; round++) {
      const page = await spaces.changesSince(space, since, 2500)
      expect(page.entries.length).toBeGreaterThan(0)
      expect(page.entries.length).toBeLessThanOrEqual(2)
      seen.push(...page.entries.map((e) => e.id))
      since = page.rev
      if (!page.more) break
    }
    expect(seen).toEqual(Array.from({ length: 10 }, (_, i) => `note-000${i}`))
    expect(since).toBe(10)
    expect(await spaces.changesSince(space, since, 2500)).toEqual({ rev: 10, more: false, entries: [] })
  })

  it('lit et nettoie les retraits de l’ancien format', async () => {
    await spaces.applyChange(space, 'note-0001', 0, blob())
    // Ancien format : retrait conservé dans le hash des notes.
    await redis.hset(`sillage:space:${space}:notes`, { 'note-0001': JSON.stringify({ id: 'note-0001', rev: 2, blob: null }) })
    await redis.zadd(`sillage:space:${space}:log`, { score: 2, member: 'note-0001' })
    await redis.set(`sillage:space:${space}:rev`, '2')

    expect((await spaces.changesSince(space, 1, 1_000_000)).entries).toEqual([{ id: 'note-0001', rev: 2, blob: null }])
    expect(await spaces.applyChange(space, 'note-0001', 2, blob())).toEqual({ ok: true, rev: 3 })
  })

  it('libère la place des membres absents depuis longtemps', async () => {
    const old = Date.now() - STALE_MEMBER_MS - 1000
    for (let i = 0; i < MAX_MEMBERS; i++) {
      expect(await spaces.upsertMember(space, { id: `member-${i}`, blob: 'b', lastSeen: i === 0 ? old : Date.now() })).toBe(true)
    }
    expect((await spaces.members(space)).map((m) => m.id)).not.toContain('member-0')
    expect(await spaces.upsertMember(space, { id: 'member-new', blob: 'b', lastSeen: Date.now() })).toBe(true)
    // Plus aucun membre inactif : l'espace est complet.
    expect(await spaces.upsertMember(space, { id: 'member-new2', blob: 'b', lastSeen: Date.now() })).toBe(false)
  })

  it('réclame les rappels par lots, une seule fois, et peut les remettre en file', async () => {
    await redis.del('sillage:due', 'sillage:items:device1', 'sillage:sub:device1')
    const subscription = { endpoint: 'https://push.example/1', keys: { p256dh: 'p', auth: 'a' } }
    const now = Date.now()
    await reminders.replaceDevice('device1', subscription, [
      { id: 'r1', at: now - 2000, title: 't', body: 'b' },
      { id: 'r2', at: now - 1000, title: 't', body: 'b' },
      { id: 'r3', at: now + 60_000, title: 't', body: 'b' },
    ])

    const [first, second] = await Promise.all([reminders.claimDue(now, 1), reminders.claimDue(now, 1)])
    expect([...first, ...second].map((r) => r.id).sort()).toEqual(['r1', 'r2'])
    expect(await reminders.claimDue(now, 10)).toEqual([])

    await reminders.requeue(first)
    expect((await reminders.claimDue(now, 10)).map((r) => r.id)).toEqual(first.map((r) => r.id))
  })
})
