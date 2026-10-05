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

export interface ChangesPage {
  /** Version jusqu'à laquelle le téléphone est à jour après cette page (son nouveau curseur). */
  rev: number
  entries: SpaceEntry[]
  /** D'autres changements attendent : le téléphone redemande à partir de `rev`. */
  more: boolean
}

/** Un espace dont personne ne s'est servi depuis un an est supprimé (expiration Redis, renouvelée à l'usage). */
export const SPACE_TTL_SECONDS = 365 * 24 * 3600
/** Taille maximale des notes d'un espace (données chiffrées). */
export const MAX_SPACE_BYTES = 20_000_000
/** Nombre maximal de notes présentes dans un espace (les notes retirées ne comptent pas). */
export const MAX_NOTES = 5000
export const MAX_MEMBERS = 30
/** Un membre absent depuis plus longtemps libère sa place quand l'espace est complet (ancien téléphone, Safari…). */
export const STALE_MEMBER_MS = 90 * 24 * 3600 * 1000
/** Changements lus par page de synchronisation. */
const PAGE_SIZE = 500

export interface SpaceStore {
  create(space: string, meta: string): Promise<boolean>
  exists(space: string): Promise<boolean>
  getMeta(space: string): Promise<string | null>
  setMeta(space: string, meta: string): Promise<void>
  /**
   * Écrit une version si personne n'a écrit depuis `baseRev` (sinon renvoie la version actuelle),
   * et si l'espace ne dépasse ni MAX_SPACE_BYTES ni MAX_NOTES.
   */
  applyChange(space: string, id: string, baseRev: number, blob: string | null): Promise<ChangeResult>
  /** Changements postérieurs à `since`, par ordre de version, dans la limite d'environ `maxBytes`. */
  changesSince(space: string, since: number, maxBytes: number): Promise<ChangesPage>
  /**
   * Ajoute ou met à jour un membre ; `false` si l'espace a déjà MAX_MEMBERS membres actifs
   * (les membres absents depuis STALE_MEMBER_MS sont retirés pour faire de la place).
   */
  upsertMember(space: string, member: Member): Promise<boolean>
  /** Retire un membre et renvoie le nombre de membres restants. */
  removeMember(space: string, id: string): Promise<number>
  /** Membres actifs (vus depuis moins de STALE_MEMBER_MS). */
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

/*
 * Modèle : le hash `notes` ne contient que les notes présentes (son HLEN est donc le nombre de notes) ;
 * le journal `log` (sorted set id → version) garde aussi les notes retirées, dont la version suffit à
 * transmettre le retrait aux autres téléphones. Les espaces créés avant ce modèle peuvent encore avoir
 * des retraits dans `notes` (`blob: null`) : ils sont lus correctement et nettoyés à la prochaine écriture.
 */

// Compare-and-set atomique : lecture de la version courante, contrôle de baseRev et des quotas, incrément et écriture.
// Chaque écriture renouvelle l'expiration des clés touchées (une note écrite n'est jamais sans expiration).
const APPLY_CHANGE = `
local cur = redis.call('HGET', KEYS[1], ARGV[1])
local curRev = 0
local oldLen = 0
if cur then
  local c = cjson.decode(cur)
  curRev = c.rev
  if type(c.blob) == 'string' then oldLen = #c.blob end
else
  curRev = tonumber(redis.call('ZSCORE', KEYS[2], ARGV[1]) or '0')
end
if curRev > tonumber(ARGV[2]) then
  if cur then return cur end
  return cjson.encode({ id = ARGV[1], rev = curRev, blob = cjson.null })
end
local live = ARGV[3] ~= ''
local delta = #ARGV[3] - oldLen
if delta > 0 and tonumber(redis.call('GET', KEYS[4]) or '0') + delta > tonumber(ARGV[4]) then return 'FULL' end
if live and not cur and redis.call('HLEN', KEYS[1]) >= tonumber(ARGV[6]) then return 'FULL' end
local rev = redis.call('INCR', KEYS[3])
if live then
  redis.call('HSET', KEYS[1], ARGV[1], cjson.encode({ id = ARGV[1], rev = rev, blob = ARGV[3] }))
else
  redis.call('HDEL', KEYS[1], ARGV[1])
end
redis.call('ZADD', KEYS[2], rev, ARGV[1])
redis.call('INCRBY', KEYS[4], delta)
for i = 1, 4 do redis.call('EXPIRE', KEYS[i], ARGV[5]) end
return tostring(rev)
`

// Lecture cohérente d'une page de changements (un seul aller-retour, aucune écriture intercalée).
// Une page s'arrête à PAGE_SIZE notes ou vers maxBytes : la réponse doit rester sous la limite de Vercel (4,5 Mo).
const CHANGES_SINCE = `
local rev = tonumber(redis.call('GET', KEYS[3]) or '0')
local items = redis.call('ZRANGEBYSCORE', KEYS[2], '(' .. ARGV[1], '+inf', 'WITHSCORES', 'LIMIT', 0, tonumber(ARGV[2]))
local entries = {}
local bytes = 0
local last = tonumber(ARGV[1])
local more = #items / 2 >= tonumber(ARGV[2])
for i = 1, #items, 2 do
  local id = items[i]
  local score = tonumber(items[i + 1])
  local raw = redis.call('HGET', KEYS[1], id)
  if not raw then raw = cjson.encode({ id = id, rev = score, blob = cjson.null }) end
  if #entries > 0 and bytes + #raw > tonumber(ARGV[3]) then
    more = true
    break
  end
  bytes = bytes + #raw
  entries[#entries + 1] = raw
  last = score
end
if more then rev = last end
return cjson.encode({ rev = rev, more = more, entries = entries })
`

// Ajout d'un membre, refusé au-delà de la limite (un membre déjà inscrit peut toujours se mettre à jour).
// Espace complet : les membres absents depuis longtemps sont d'abord retirés pour libérer leur place.
const UPSERT_MEMBER = `
if redis.call('HEXISTS', KEYS[1], ARGV[1]) == 0 and redis.call('HLEN', KEYS[1]) >= tonumber(ARGV[3]) then
  local all = redis.call('HGETALL', KEYS[1])
  for i = 1, #all, 2 do
    local m = cjson.decode(all[i + 1])
    if tonumber(ARGV[5]) - m.lastSeen > tonumber(ARGV[6]) then redis.call('HDEL', KEYS[1], all[i]) end
  end
  if redis.call('HLEN', KEYS[1]) >= tonumber(ARGV[3]) then return 0 end
end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('EXPIRE', KEYS[1], ARGV[4])
return 1
`

const isActive = (m: Member, now: number) => now - m.lastSeen <= STALE_MEMBER_MS

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
      [id, String(baseRev), blob ?? '', String(MAX_SPACE_BYTES), String(SPACE_TTL_SECONDS), String(MAX_NOTES)],
    )
    if (result === 'FULL') return { ok: false, full: true }
    return /^\d+$/.test(result) ? { ok: true, rev: Number(result) } : { ok: false, current: JSON.parse(result) }
  }
  async changesSince(space: string, since: number, maxBytes: number) {
    const raw = await this.redis.eval<string[], string>(
      CHANGES_SINCE,
      [K.notes(space), K.log(space), K.rev(space)],
      [String(since), String(PAGE_SIZE), String(maxBytes)],
    )
    const page = JSON.parse(raw) as { rev: number; more: boolean; entries: string[] | Record<string, never> }
    // cjson encode une table Lua vide en objet `{}`, pas en tableau.
    const entries = Array.isArray(page.entries) ? page.entries.map((e) => JSON.parse(e) as SpaceEntry) : []
    return { rev: page.rev, more: page.more, entries }
  }
  async upsertMember(space: string, member: Member) {
    const ok = await this.redis.eval<string[], number>(
      UPSERT_MEMBER,
      [K.members(space)],
      [member.id, JSON.stringify(member), String(MAX_MEMBERS), String(SPACE_TTL_SECONDS), String(Date.now()), String(STALE_MEMBER_MS)],
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
    const now = Date.now()
    return all.map((m) => JSON.parse(m) as Member).filter((m) => isActive(m, now))
  }
}

/** Équivalent en mémoire pour le développement local sans Redis (mêmes règles, sans expiration). */
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
    const delta = new TextEncoder().encode(blob ?? '').length - new TextEncoder().encode(cur?.blob ?? '').length
    if (delta > 0 && s.bytes + delta > MAX_SPACE_BYTES) return { ok: false, full: true }
    const live = [...s.notes.values()].filter((e) => e.blob !== null).length
    if (blob !== null && !cur?.blob && live >= MAX_NOTES) return { ok: false, full: true }
    s.bytes += delta
    const rev = ++s.rev
    s.notes.set(id, { id, rev, blob })
    return { ok: true, rev }
  }
  async changesSince(space: string, since: number, maxBytes: number) {
    const s = this.get(space)
    const all = [...s.notes.values()].filter((e) => e.rev > since).sort((a, b) => a.rev - b.rev)
    const entries: SpaceEntry[] = []
    let bytes = 0
    for (const e of all.slice(0, PAGE_SIZE)) {
      const size = JSON.stringify(e).length
      if (entries.length && bytes + size > maxBytes) break
      bytes += size
      entries.push(e)
    }
    const more = entries.length < all.length
    return { rev: more ? entries[entries.length - 1].rev : s.rev, entries, more }
  }
  async upsertMember(space: string, member: Member) {
    const members = this.get(space).members
    if (!members.has(member.id) && members.size >= MAX_MEMBERS) {
      for (const m of members.values()) if (!isActive(m, Date.now())) members.delete(m.id)
      if (members.size >= MAX_MEMBERS) return false
    }
    members.set(member.id, member)
    return true
  }
  async removeMember(space: string, id: string) {
    const members = this.get(space).members
    members.delete(id)
    return members.size
  }
  async members(space: string) {
    const now = Date.now()
    return [...this.get(space).members.values()].filter((m) => isActive(m, now))
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
