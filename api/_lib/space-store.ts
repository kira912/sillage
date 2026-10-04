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

export type ChangeResult = { ok: true; rev: number } | { ok: false; current: SpaceEntry } | { ok: false; full: true }

/** Un espace dont personne ne s'est servi depuis un an est supprimé (expiration Redis, renouvelée à l'usage). */
export const SPACE_TTL_SECONDS = 365 * 24 * 3600
/** Taille maximale des notes d'un espace (données chiffrées). */
export const MAX_SPACE_BYTES = 20_000_000
export const MAX_MEMBERS = 30

export interface SpaceStore {
  create(space: string, meta: string): Promise<boolean>
  exists(space: string): Promise<boolean>
  getMeta(space: string): Promise<string | null>
  setMeta(space: string, meta: string): Promise<void>
  /**
   * Écrit une version si personne n'a écrit depuis `baseRev` (sinon renvoie la version actuelle),
   * et si l'espace ne dépasse pas MAX_SPACE_BYTES.
   */
  applyChange(space: string, id: string, baseRev: number, blob: string | null): Promise<ChangeResult>
  changesSince(space: string, since: number): Promise<{ rev: number; entries: SpaceEntry[] }>
  noteCount(space: string): Promise<number>
  /** Ajoute ou met à jour un membre ; `false` si l'espace a déjà MAX_MEMBERS membres. */
  upsertMember(space: string, member: Member): Promise<boolean>
  /** Retire un membre et renvoie le nombre de membres restants. */
  removeMember(space: string, id: string): Promise<number>
  members(space: string): Promise<Member[]>
  /** Repousse l'expiration de l'espace (au plus une fois par jour). */
  touch(space: string): Promise<void>
  delete(space: string): Promise<void>
}

const K = {
  meta: (s: string) => `sillage:space:${s}:meta`,
  rev: (s: string) => `sillage:space:${s}:rev`,
  notes: (s: string) => `sillage:space:${s}:notes`,
  log: (s: string) => `sillage:space:${s}:log`,
  members: (s: string) => `sillage:space:${s}:members`,
  bytes: (s: string) => `sillage:space:${s}:bytes`,
  touched: (s: string) => `sillage:space:${s}:touched`,
}

const allKeys = (s: string) => [K.meta(s), K.rev(s), K.notes(s), K.log(s), K.members(s), K.bytes(s)]

// Compare-and-set atomique : lecture de la version courante, contrôle de baseRev et du quota, incrément et écriture.
// Chaque écriture renouvelle l'expiration des clés touchées (une note écrite n'est jamais sans expiration).
const APPLY_CHANGE = `
local cur = redis.call('HGET', KEYS[1], ARGV[1])
local oldLen = 0
if cur then
  local c = cjson.decode(cur)
  if c.rev > tonumber(ARGV[2]) then return cur end
  if type(c.blob) == 'string' then oldLen = #c.blob end
end
local blob = cjson.null
if ARGV[3] ~= '' then blob = ARGV[3] end
local delta = #ARGV[3] - oldLen
local used = tonumber(redis.call('GET', KEYS[4]) or '0')
if delta > 0 and used + delta > tonumber(ARGV[4]) then return 'FULL' end
local rev = redis.call('INCR', KEYS[3])
redis.call('HSET', KEYS[1], ARGV[1], cjson.encode({ id = ARGV[1], rev = rev, blob = blob }))
redis.call('ZADD', KEYS[2], rev, ARGV[1])
redis.call('INCRBY', KEYS[4], delta)
for i = 1, 4 do redis.call('EXPIRE', KEYS[i], ARGV[5]) end
return tostring(rev)
`

// Ajout d'un membre, refusé au-delà de la limite (un membre déjà inscrit peut toujours se mettre à jour).
const UPSERT_MEMBER = `
if redis.call('HEXISTS', KEYS[1], ARGV[1]) == 0 and redis.call('HLEN', KEYS[1]) >= tonumber(ARGV[3]) then return 0 end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('EXPIRE', KEYS[1], ARGV[4])
return 1
`

class RedisSpaceStore implements SpaceStore {
  constructor(private redis: Redis) {}

  async create(space: string, meta: string) {
    return (await this.redis.set(K.meta(space), meta, { nx: true, ex: SPACE_TTL_SECONDS })) === 'OK'
  }
  async exists(space: string) {
    return (await this.redis.exists(K.meta(space))) === 1
  }
  getMeta(space: string) {
    return this.redis.get<string>(K.meta(space))
  }
  async setMeta(space: string, meta: string) {
    await this.redis.set(K.meta(space), meta, { ex: SPACE_TTL_SECONDS })
  }
  async applyChange(space: string, id: string, baseRev: number, blob: string | null): Promise<ChangeResult> {
    const result = await this.redis.eval<string[], string>(
      APPLY_CHANGE,
      [K.notes(space), K.log(space), K.rev(space), K.bytes(space)],
      [id, String(baseRev), blob ?? '', String(MAX_SPACE_BYTES), String(SPACE_TTL_SECONDS)],
    )
    if (result === 'FULL') return { ok: false, full: true }
    return /^\d+$/.test(result) ? { ok: true, rev: Number(result) } : { ok: false, current: JSON.parse(result) }
  }
  async changesSince(space: string, since: number) {
    const [revRaw, ids] = await Promise.all([
      this.redis.get<string>(K.rev(space)),
      this.redis.zrange<string[]>(K.log(space), `(${since}`, '+inf', { byScore: true }),
    ])
    // Sans désérialisation automatique, HMGET renvoie les valeurs brutes dans l'ordre des champs demandés.
    const raw = ids.length ? ((await this.redis.hmget(K.notes(space), ...ids)) as unknown as (string | null)[]) : []
    const entries = raw.flatMap((v) => (v ? [JSON.parse(v) as SpaceEntry] : []))
    return { rev: Number(revRaw ?? 0), entries }
  }
  noteCount(space: string) {
    return this.redis.hlen(K.notes(space))
  }
  async upsertMember(space: string, member: Member) {
    const ok = await this.redis.eval<string[], number>(
      UPSERT_MEMBER,
      [K.members(space)],
      [member.id, JSON.stringify(member), String(MAX_MEMBERS), String(SPACE_TTL_SECONDS)],
    )
    return ok === 1
  }
  async removeMember(space: string, id: string) {
    await this.redis.hdel(K.members(space), id)
    return this.redis.hlen(K.members(space))
  }
  async touch(space: string) {
    // Marqueur d'un jour : l'expiration n'est renouvelée qu'une fois par jour, pas à chaque synchronisation.
    if ((await this.redis.set(K.touched(space), '1', { nx: true, ex: 24 * 3600 })) !== 'OK') return
    const pipeline = this.redis.pipeline()
    for (const key of allKeys(space)) pipeline.expire(key, SPACE_TTL_SECONDS)
    await pipeline.exec()
  }
  async delete(space: string) {
    await this.redis.del(...allKeys(space), K.touched(space))
  }
  async members(space: string) {
    // HVALS plutôt que HGETALL : sans désérialisation automatique, HGETALL renvoie un tableau plat [champ, valeur, …].
    const all = (await this.redis.hvals(K.members(space))) as string[]
    return all.map((m) => JSON.parse(m) as Member)
  }
}

/** Équivalent en mémoire pour le développement local. */
class MemorySpaceStore implements SpaceStore {
  private spaces = new Map<
    string,
    { meta: string; rev: number; bytes: number; notes: Map<string, SpaceEntry>; members: Map<string, Member> }
  >()

  private get(space: string) {
    const s = this.spaces.get(space)
    if (!s) throw new Error('espace inconnu')
    return s
  }
  async create(space: string, meta: string) {
    if (this.spaces.has(space)) return false
    this.spaces.set(space, { meta, rev: 0, bytes: 0, notes: new Map(), members: new Map() })
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
    const delta = (blob?.length ?? 0) - (cur?.blob?.length ?? 0)
    if (delta > 0 && s.bytes + delta > MAX_SPACE_BYTES) return { ok: false, full: true }
    s.bytes += delta
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
    const members = this.get(space).members
    if (!members.has(member.id) && members.size >= MAX_MEMBERS) return false
    members.set(member.id, member)
    return true
  }
  async removeMember(space: string, id: string) {
    const members = this.get(space).members
    members.delete(id)
    return members.size
  }
  async members(space: string) {
    return [...this.get(space).members.values()]
  }
  async touch() {
    /* pas d'expiration en mémoire */
  }
  async delete(space: string) {
    this.spaces.delete(space)
  }
}

let store: SpaceStore | undefined

export function getSpaceStore(): SpaceStore {
  if (store) return store
  const redis = getRedis()
  store = redis ? new RedisSpaceStore(redis) : new MemorySpaceStore()
  return store
}
