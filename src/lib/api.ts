const CODE_KEY = 'sillage:access-code'

export function getAccessCode(): string {
  try {
    return localStorage.getItem(CODE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function setAccessCode(code: string) {
  try {
    if (code) localStorage.setItem(CODE_KEY, code)
    else localStorage.removeItem(CODE_KEY)
  } catch {
    /* stockage indisponible : le code sera redemandé */
  }
}

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

interface ApiInit {
  method?: string
  body?: unknown
  /** Délai maximal : sur un réseau mobile instable, une requête peut sinon rester bloquée de longues minutes. */
  timeoutMs?: number
  /** Annulation par l'appelant (ex. écran fermé). */
  signal?: AbortSignal
}

/** Appel aux fonctions serveur (`/api/*`) avec le code d'accès de l'appareil. */
export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  if (!navigator.onLine) throw new ApiError('Pas de connexion internet', 0)
  // AbortController plutôt qu'AbortSignal.any (absent avant iOS 17.4).
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, init.timeoutMs ?? 20_000)
  const cancel = () => controller.abort()
  init.signal?.addEventListener('abort', cancel, { once: true })
  try {
    let res: Response
    try {
      res = await fetch(`/api/${path}`, {
        method: init.method ?? (init.body ? 'POST' : 'GET'),
        headers: { 'content-type': 'application/json', 'x-sillage-code': getAccessCode() },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: controller.signal,
      })
    } catch (e) {
      if (init.signal?.aborted) throw e
      throw new ApiError(timedOut ? 'Le serveur met trop de temps à répondre' : 'Serveur injoignable', 0)
    }
    const data = await res.json().catch(() => {
      if (controller.signal.aborted) throw new ApiError('Le serveur met trop de temps à répondre', 0)
      return null
    })
    if (!res.ok) throw new ApiError(data?.error ?? `Erreur ${res.status}`, res.status)
    return data as T
  } finally {
    clearTimeout(timer)
    init.signal?.removeEventListener('abort', cancel)
  }
}

export interface ServerConfig {
  ai: boolean
  push: boolean
  vapidPublicKey: string | null
  /** Dernier passage du cron d'envoi des rappels (ms), `null` s'il n'est jamais passé. */
  cronLastRun: number | null
}

export const fetchConfig = () => api<ServerConfig>('config')
