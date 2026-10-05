import type { Redis } from '@upstash/redis'
import { createHash } from 'node:crypto'
import type { PushSubscription } from 'web-push'
import { getRedis } from './redis.js'

/** Un rappel planifié : `at` en millisecondes epoch (calculé sur le téléphone, dans son fuseau). */
export interface Reminder {
  id: string
  at: number
  title: string
  body: string
}

export interface DueReminder extends Reminder {
  device: string
}

export interface Store {
  /** Remplace intégralement la subscription et les rappels d'un appareil. */
  replaceDevice(device: string, subscription: PushSubscription, reminders: Reminder[]): Promise<void>
  getSubscription(device: string): Promise<PushSubscription | null>
  removeDevice(device: string): Promise<void>
  /**
   * Retire et renvoie au plus `limit` rappels arrivés à échéance, de façon atomique :
   * deux crons simultanés ne reçoivent jamais le même rappel.
   */
  claimDue(now: number, limit: number): Promise<DueReminder[]>
  /** Remet en file des rappels réclamés dont l'envoi a échoué temporairement. */
  requeue(reminders: DueReminder[]): Promise<void>
  recordCronRun(at: number): Promise<void>
  lastCronRun(): Promise<number | null>
}

export const deviceId = (endpoint: string) => createHash('sha256').update(endpoint).digest('hex').slice(0, 32)

const K = {
  due: 'sillage:due',
  cronLast: 'sillage:cron:last',
  sub: (d: string) => `sillage:sub:${d}`,
  items: (d: string) => `sillage:items:${d}`,
}

// Lecture et retrait dans le même script : un rappel n'est réclamé qu'une fois, en un seul aller-retour.
const CLAIM_DUE = `
local items = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, tonumber(ARGV[2]))
if #items > 0 then redis.call('ZREM', KEYS[1], unpack(items)) end
return items
`

class RedisStore implements Store {
  constructor(private redis: Redis) {}

  async replaceDevice(device: string, subscription: PushSubscription, reminders: Reminder[]) {
    const old = await this.redis.smembers<string[]>(K.items(device))
    const members = reminders.map((r) => JSON.stringify({ device, ...r }))
    const tx = this.redis.multi()
    if (old.length) tx.zrem(K.due, ...old)
    tx.del(K.items(device))
    tx.set(K.sub(device), JSON.stringify(subscription))
    if (members.length) {
      const [first, ...rest] = reminders.map((r, i) => ({ score: r.at, member: members[i] }))
      tx.zadd(K.due, first, ...rest)
      tx.sadd(K.items(device), members[0], ...members.slice(1))
    }
    await tx.exec()
  }

  async getSubscription(device: string) {
    const raw = await this.redis.get<string>(K.sub(device))
    return raw ? (JSON.parse(raw) as PushSubscription) : null
  }

  async removeDevice(device: string) {
    const old = await this.redis.smembers<string[]>(K.items(device))
    const tx = this.redis.multi()
    if (old.length) tx.zrem(K.due, ...old)
    tx.del(K.items(device), K.sub(device))
    await tx.exec()
  }

  async claimDue(now: number, limit: number) {
    const members = await this.redis.eval<string[], string[]>(CLAIM_DUE, [K.due], [String(now), String(limit)])
    const claimed = members.map((m) => JSON.parse(m) as DueReminder)
    if (claimed.length) {
      const pipeline = this.redis.pipeline()
      claimed.forEach((r, i) => pipeline.srem(K.items(r.device), members[i]))
      await pipeline.exec()
    }
    return claimed
  }

  async requeue(reminders: DueReminder[]) {
    if (!reminders.length) return
    const pipeline = this.redis.pipeline()
    for (const r of reminders) {
      const member = JSON.stringify(r)
      pipeline.zadd(K.due, { score: r.at, member })
      pipeline.sadd(K.items(r.device), member)
    }
    await pipeline.exec()
  }

  async recordCronRun(at: number) {
    await this.redis.set(K.cronLast, String(at))
  }

  async lastCronRun() {
    const raw = await this.redis.get<string>(K.cronLast)
    return raw ? Number(raw) : null
  }
}

/** Stockage en mémoire pour le développement local (perdu au redémarrage). */
class MemoryStore implements Store {
  private subs = new Map<string, PushSubscription>()
  private due = new Map<string, DueReminder[]>()

  async replaceDevice(device: string, subscription: PushSubscription, reminders: Reminder[]) {
    this.subs.set(device, subscription)
    this.due.set(device, reminders.map((r) => ({ device, ...r })))
  }
  async getSubscription(device: string) {
    return this.subs.get(device) ?? null
  }
  async removeDevice(device: string) {
    this.subs.delete(device)
    this.due.delete(device)
  }
  private cronLast: number | null = null

  async claimDue(now: number, limit: number) {
    const out: DueReminder[] = []
    for (const [device, list] of this.due) {
      const due = list.filter((r) => r.at <= now).slice(0, limit - out.length)
      out.push(...due)
      this.due.set(device, list.filter((r) => !due.includes(r)))
    }
    return out
  }
  async requeue(reminders: DueReminder[]) {
    for (const r of reminders) this.due.set(r.device, [...(this.due.get(r.device) ?? []), r])
  }
  async recordCronRun(at: number) {
    this.cronLast = at
  }
  async lastCronRun() {
    return this.cronLast
  }
}

let store: Store | undefined

export function getStore(): Store {
  if (store) return store
  const redis = getRedis()
  store = redis ? new RedisStore(redis) : new MemoryStore()
  return store
}
