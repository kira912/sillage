import { Redis } from '@upstash/redis'
import { createHash } from 'node:crypto'
import type { PushSubscription } from 'web-push'

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
  /** Retire et renvoie les rappels arrivés à échéance (chaque rappel n'est rendu qu'une fois). */
  claimDue(now: number): Promise<DueReminder[]>
}

export const deviceId = (endpoint: string) => createHash('sha256').update(endpoint).digest('hex').slice(0, 32)

const K = {
  due: 'sillage:due',
  sub: (d: string) => `sillage:sub:${d}`,
  items: (d: string) => `sillage:items:${d}`,
}

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

  async claimDue(now: number) {
    const members = await this.redis.zrange<string[]>(K.due, 0, now, { byScore: true })
    const claimed: DueReminder[] = []
    for (const member of members) {
      // ZREM renvoie 1 seulement pour l'appel qui retire l'élément : deux crons simultanés n'envoient pas en double.
      if ((await this.redis.zrem(K.due, member)) === 1) {
        const r = JSON.parse(member) as DueReminder
        await this.redis.srem(K.items(r.device), member)
        claimed.push(r)
      }
    }
    return claimed
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
  async claimDue(now: number) {
    const out: DueReminder[] = []
    for (const [device, list] of this.due) {
      out.push(...list.filter((r) => r.at <= now))
      this.due.set(device, list.filter((r) => r.at > now))
    }
    return out
  }
}

let store: Store | undefined

export function getStore(): Store {
  if (store) return store
  // Variables posées par l'intégration Upstash de Vercel (anciennement « Vercel KV ») ou par Upstash directement.
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  if (url && token) {
    store = new RedisStore(new Redis({ url, token, automaticDeserialization: false }))
  } else {
    if (process.env.VERCEL) throw new Error('Redis non configuré (KV_REST_API_URL / KV_REST_API_TOKEN)')
    console.warn('[sillage] Redis non configuré : stockage en mémoire (dev uniquement)')
    store = new MemoryStore()
  }
  return store
}
