import { checkAccess } from './_lib/auth.js'
import { guard, json } from './_lib/http.js'
import { pushConfigured, vapidPublicKey } from './_lib/push.js'
import { getStore } from './_lib/store.js'

/** Vérifie le code d'accès et indique quelles fonctions sont disponibles sur ce déploiement. */
export const GET = guard(async (request: Request) => {
  const denied = await checkAccess(request)
  if (denied) return denied
  const push = pushConfigured()
  return json({
    ai: !!process.env.ANTHROPIC_API_KEY,
    push,
    vapidPublicKey: vapidPublicKey(),
    // Dernier passage du cron d'envoi des rappels : permet de voir dans l'app s'il s'est arrêté.
    cronLastRun: push ? await getStore().lastCronRun() : null,
  })
})
