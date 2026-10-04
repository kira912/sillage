import { getRedis } from './redis.js'

/** Compteurs en mémoire pour le développement local (sans Redis). */
const memory = new Map<string, { count: number; resetAt: number }>()

// Incrément et expiration atomiques : un compteur ne peut pas rester sans expiration (IP bloquée pour toujours).
const INCR = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n
`

/** Adresse IP du client, posée par Vercel (non falsifiable par le client). */
export function clientIp(request: Request): string {
  return (
    request.headers.get('x-real-ip')?.trim() ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'local'
  )
}

/**
 * Limite le nombre d'appels par fenêtre de temps (fenêtre fixe).
 * Renvoie `true` si l'appel est autorisé.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const redis = getRedis()
  if (redis) {
    const count = await redis.eval<string[], number>(INCR, [`sillage:rl:${key}`], [String(windowSeconds)])
    return count <= limit
  }
  const now = Date.now()
  const entry = memory.get(key)
  if (!entry || entry.resetAt <= now) {
    memory.set(key, { count: 1, resetAt: now + windowSeconds * 1000 })
    return true
  }
  return ++entry.count <= limit
}
