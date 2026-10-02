import { Redis } from '@upstash/redis'
import { ConfigError } from './http.js'

/** Paires de variables (URL, jeton) posées par l'intégration Upstash de Vercel ou par Upstash directement. */
const PAIRS = [
  ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
  ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
] as const

/** Trouve la paire URL/jeton, y compris avec un préfixe personnalisé choisi à l'installation (ex. STORAGE_KV_REST_API_URL). */
function findCredentials(): { url: string; token: string } | null {
  for (const [urlName, tokenName] of PAIRS) {
    for (const [key, url] of Object.entries(process.env)) {
      if (!url || (key !== urlName && !key.endsWith(`_${urlName}`))) continue
      const token = process.env[key.slice(0, key.length - urlName.length) + tokenName]
      if (token) return { url, token }
    }
  }
  return null
}

let client: Redis | null | undefined

/** Client Redis, ou `null` en développement local sans Redis (stockage en mémoire). */
export function getRedis(): Redis | null {
  if (client !== undefined) return client
  const credentials = findCredentials()
  if (credentials) {
    client = new Redis({ ...credentials, automaticDeserialization: false })
  } else if (process.env.VERCEL) {
    throw new ConfigError(
      'Redis non configuré : ajoutez l’intégration Upstash Redis au projet Vercel (variables KV_REST_API_URL et KV_REST_API_TOKEN), puis redéployez.',
    )
  } else {
    console.warn('[sillage] Redis non configuré : stockage en mémoire (dev uniquement)')
    client = null
  }
  return client
}
