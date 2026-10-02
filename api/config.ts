import { checkAccess, json } from './_lib/http.js'
import { pushConfigured, vapidPublicKey } from './_lib/push.js'

/** Vérifie le code d'accès et indique quelles fonctions sont disponibles sur ce déploiement. */
export function GET(request: Request) {
  const denied = checkAccess(request)
  if (denied) return denied
  return json({
    ai: !!process.env.ANTHROPIC_API_KEY,
    push: pushConfigured(),
    vapidPublicKey: vapidPublicKey(),
  })
}
