import type { Redis } from '@upstash/redis'
import { getRedis } from './redis.js'

/**
 * Stockage des espaces partagés. Le serveur ne voit que des blobs chiffrés côté téléphone
 * (contenu des notes, nom de l'espace, prénoms) : il ne gère que les versions (`rev`) et l'ordre des changements.
 */

/** Version d'une note dans l'espace ; `blob: null` = note retirée de l'espace. */
export interface SpaceEntry {
  id: string
  rev: number
  blob: string | null
}

export interface Member {
  id: string
  blob: string
  lastSeen: number
}

export type ChangeResult = { ok: true; rev: number } | { ok: false; current: SpaceEntry }

export interface SpaceStore {
  create(space: string, meta: string): Promise<boolean>
  exists(space: string): Promise<boolean>
  getMeta(space: string): Promise<string | null>
  setMeta(space: string, meta: string): Promise<void>
  /** Écrit une version si personne n'a écrit depuis `baseRev` (sinon renvoie la version actuelle). */
  applyChange(space: string, id: string, baseRev: number, blob: string | null): Promise<ChangeResult>
  changesSince(space: string, since: number): Promise<{ rev: number; entries: SpaceEntry[] }>
  noteCount(space: string): Promise<number>
  upsertMember(space: string, member: Member): Promise<void>
  removeMember(space: string, id: string): Promise<void>
  members(space: string): Promise<Member[]>
}

const K = {
  meta: (s: string) => `sillage:space:${s}:meta`,
  rev: (s: string) => `sillage:space:${s}:rev`,
  notes: (s: string) => `sillage:space:${s}:notes`,
  log: (s: string) => `sillage:space:${s}:log`,
  members: (s: string) => `sillage:space:${s}:members`,
}

// Compare-and-set atomique : lecture de la version courante, contrôle de baseRev, incrément et écriture.
const APPLY_CHANGE = `
local cur = redis.call('HGET', KEYS[1], ARGV[1])
if cur then
  local c = cjson.decode(cur)
  if c.rev > tonumber(ARGV[2]) then return cur end
end
local rev = redis.call('INCR', KEYS[3])
local blob = cjson.null
if ARGV[3] ~= '' then blob = ARGV[3] end
redis.call('HSET', KEYS[1], ARGV[1], cjson.encode({ id = ARGV[1], rev = rev, blob = blob }))
redis.call('ZADD', KEYS[2], rev, ARGV[1])
return tostring(rev)
`

class RedisSpaceStore implements SpaceStore {
  constructor(private redis: Redis) {}

  async create(space: string, meta: string) {
    return (await this.redis.set(K.meta(space), meta, { nx: true })) === 'OK'
  }
  async exists(space: string) {
    return (await this.redis.exists(K.meta(space))) === 1
  }
  getMeta(space: string) {
    return this.redis.get<string>(K.meta(space))
  }
  async setMeta(space: string, meta: string) {
    await this.redis.set(K.meta(space), meta)
  }
  async applyChange(space: string, id: string, baseRev: number, blob: string | null): Promise<ChangeResult> {
    const result = await this.redis.eval<string[], string>(APPLY_CHANGE, [K.notes(space), K.log(space), K.rev(space)], [
      id,
      String(baseRev),
      blob ?? '',
    ])
    return /^\d+$/.test(result) ? { ok: true, rev: Number(result) } : { ok: false, current: JSON.parse(result) }
  }
  async changesSince(space: string, since: number) {
    const [revRaw, ids] = await Promise.all([
      this.redis.get<string>(K.rev(space)),
      this.redis.zrange<string[]>(K.log(space), `(${since}`, '+inf', { byScore: true }),
    ])
    const raw = ids.length ? await this.redis.hmget<Record<string, string | null>>(K.notes(space), ...ids) : null
    const entries = ids.flatMap((id) => (raw?.[id] ? [JSON.parse(raw[id]) as SpaceEntry] : []))
    return { rev: Number(revRaw ?? 0), entries }
  }
  noteCount(space: string) {
    return this.redis.hlen(K.notes(space))
  }
  async upsertMember(space: string, member: Member) {
    await this.redis.hset(K.members(space), { [member.id]: JSON.stringify(member) })
  }
  async removeMember(space: string, id: string) {
    await this.redis.hdel(K.members(space), id)
  }
  async members(space: string) {
    const all = await this.redis.hgetall<Record<string, string>>(K.members(space))
    return Object.values(all ?? {}).map((m) => JSON.parse(m) as Member)
  }
}

/** Équivalent en mémoire pour le développement local. */
class MemorySpaceStore implements SpaceStore {
  private spaces = new Map<string, { meta: string; rev: number; notes: Map<string, SpaceEntry>; members: Map<string, Member> }>()

  private get(space: string) {
    const s = this.spaces.get(space)
    if (!s) throw new Error('espace inconnu')
    return s
  }
  async create(space: string, meta: string) {
    if (this.spaces.has(space)) return false
    this.spaces.set(space, { meta, rev: 0, notes: new Map(), members: new Map() })
    return true
  }
  async exists(space: string) {
    return this.spaces.has(space)
  }
  async getMeta(space: string) {
    return this.spaces.get(space)?.meta ?? null
  }
  async setMeta(space: string, meta: string) {
    this.get(space).meta = meta
  }
  async applyChange(space: string, id: string, baseRev: number, blob: string | null): Promise<ChangeResult> {
    const s = this.get(space)
    const cur = s.notes.get(id)
    if (cur && cur.rev > baseRev) return { ok: false, current: cur }
    const rev = ++s.rev
    s.notes.set(id, { id, rev, blob })
    return { ok: true, rev }
  }
  async changesSince(space: string, since: number) {
    const s = this.get(space)
    return { rev: s.rev, entries: [...s.notes.values()].filter((e) => e.rev > since).sort((a, b) => a.rev - b.rev) }
  }
  async noteCount(space: string) {
    return this.get(space).notes.size
  }
  async upsertMember(space: string, member: Member) {
    this.get(space).members.set(member.id, member)
  }
  async removeMember(space: string, id: string) {
    this.get(space).members.delete(id)
  }
  async members(space: string) {
    return [...this.get(space).members.values()]
  }
}

let store: SpaceStore | undefined

export function getSpaceStore(): SpaceStore {
  if (store) return store
  const redis = getRedis()
  store = redis ? new RedisSpaceStore(redis) : new MemorySpaceStore()
  return store
}
