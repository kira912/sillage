import { checkAccess } from './_lib/auth.js'
import { guard, json } from './_lib/http.js'
import { pushConfigured, vapidPublicKey } from './_lib/push.js'
import { getStore } from './_lib/store.js'

/**
 * Fonctions disponibles sur ce déploiement, pour tous (IA avec quota gratuit, rappels). Avec un code d'accès,
 * il est vérifié (`access`) et l'état de l'envoi des rappels est donné en plus.
 */
export const GET = guard(async (request: Request) => {
  const withCode = !!request.headers.get('x-sillage-code')
  if (withCode) {
    const denied = await checkAccess(request)
    if (denied) return denied
  }
  const push = pushConfigured()
  return json({
    ai: !!process.env.ANTHROPIC_API_KEY,
    push,
    vapidPublicKey: vapidPublicKey(),
    access: withCode,
    // Dernier passage du cron d'envoi des rappels : permet de voir dans l'app s'il s'est arrêté.
    cronLastRun: push && withCode ? await getStore().lastCronRun() : null,
  })
})
