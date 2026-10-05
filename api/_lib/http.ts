export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })

export const error = (status: number, message: string) => json({ error: message }, status)

/** Configuration serveur manquante ou invalide : renvoyée en 503 avec un message explicite. */
export class ConfigError extends Error {}

type Handler = (request: Request) => Promise<Response> | Response

/** Transforme toute exception en réponse JSON (au lieu d'un « Internal Server Error » opaque). */
export function guard(handler: Handler): Handler {
  return async (request) => {
    try {
      return await handler(request)
    } catch (e) {
      console.error('[sillage]', e)
      if (e instanceof ConfigError) return error(503, e.message)
      // Le détail reste dans les logs : il peut contenir des informations internes (Redis, configuration).
      return error(500, 'Erreur serveur, réessayez dans un instant')
    }
  }
}

export async function readJson<T>(request: Request, maxBytes = 64_000): Promise<T | null> {
  const text = await request.text()
  if (text.length > maxBytes) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}
