import { checkCron, json } from './_lib/http.js'
import { sendPush } from './_lib/push.js'
import { getStore } from './_lib/store.js'

/** Un rappel en retard de plus de 2 h n'est plus envoyé (ex. cron en panne pendant la nuit). */
const MAX_LATE_MS = 2 * 3600 * 1000

/**
 * Envoie les rappels arrivés à échéance. À appeler chaque minute :
 * Vercel Cron (plan Pro) ou un service externe comme cron-job.org (plan Hobby).
 */
export async function GET(request: Request) {
  const denied = checkCron(request)
  if (denied) return denied

  const store = getStore()
  const now = Date.now()
  const due = await store.claimDue(now)
  let sent = 0
  let skipped = 0
  const gone = new Set<string>()

  for (const r of due) {
    if (gone.has(r.device) || now - r.at > MAX_LATE_MS) {
      skipped++
      continue
    }
    const subscription = await store.getSubscription(r.device)
    if (!subscription) {
      skipped++
      continue
    }
    try {
      if ((await sendPush(subscription, { title: r.title, body: r.body, tag: r.id })) === 'gone') {
        gone.add(r.device)
        await store.removeDevice(r.device)
      } else {
        sent++
      }
    } catch (e) {
      console.error('[sillage] échec d’envoi push', r.id, e)
    }
  }

  return json({ due: due.length, sent, skipped, removedDevices: gone.size })
}
