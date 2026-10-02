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

/** Appel aux fonctions serveur (`/api/*`) avec le code d'accès de l'appareil. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  if (!navigator.onLine) throw new ApiError('Pas de connexion internet', 0)
  let res: Response
  try {
    res = await fetch(`/api/${path}`, {
      method: init.method ?? (init.body ? 'POST' : 'GET'),
      headers: { 'content-type': 'application/json', 'x-sillage-code': getAccessCode() },
      body: init.body ? JSON.stringify(init.body) : undefined,
    })
  } catch {
    throw new ApiError('Serveur injoignable', 0)
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(data?.error ?? `Erreur ${res.status}`, res.status)
  return data as T
}

export interface ServerConfig {
  ai: boolean
  push: boolean
  vapidPublicKey: string | null
}

export const fetchConfig = () => api<ServerConfig>('config')
