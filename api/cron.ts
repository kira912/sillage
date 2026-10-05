import type { PushSubscription } from 'web-push'
import { checkCron } from './_lib/auth.js'
import { guard, json } from './_lib/http.js'
import { sendPush } from './_lib/push.js'
import { getStore, type DueReminder } from './_lib/store.js'

/** Un rappel en retard de plus de 2 h n'est plus envoyé (ex. cron en panne pendant la nuit). */
const MAX_LATE_MS = 2 * 3600 * 1000
/** Rappels réclamés par lot : ce qui n'a pas été réclamé reste en file si la fonction s'arrête. */
const CLAIM_BATCH = 200
/** Envois simultanés : assez pour absorber le pic de 9 h, sans rafale vers les services push. */
const CONCURRENCY = 25
/** Au-delà, on s'arrête et le passage suivant (une minute plus tard) reprend la file. */
const TIME_BUDGET_MS = 45_000

/**
 * Envoie les rappels arrivés à échéance. À appeler chaque minute :
 * Vercel Cron (plan Pro) ou un service externe comme cron-job.org (plan Hobby).
 */
export const GET = guard(async (request: Request) => {
  const denied = checkCron(request)
  if (denied) return denied

  const store = getStore()
  const started = Date.now()
  const subscriptions = new Map<string, Promise<PushSubscription | null>>()
  const gone = new Set<string>()
  const stats = { due: 0, sent: 0, skipped: 0, failed: 0 }

  async function deliver(r: DueReminder): Promise<'sent' | 'skipped' | 'retry'> {
    if (gone.has(r.device) || started - r.at > MAX_LATE_MS) return 'skipped'
    if (!subscriptions.has(r.device)) subscriptions.set(r.device, store.getSubscription(r.device))
    const subscription = await subscriptions.get(r.device)
    if (!subscription) return 'skipped'
    try {
      if ((await sendPush(subscription, { title: r.title, body: r.body, tag: r.id })) === 'sent') return 'sent'
      gone.add(r.device)
      await store.removeDevice(r.device)
      return 'skipped'
    } catch (e) {
      console.error('[sillage] échec d’envoi push', r.id, e)
      return 'retry'
    }
  }

  const retry: DueReminder[] = []
  while (Date.now() - started < TIME_BUDGET_MS) {
    const due = await store.claimDue(Date.now(), CLAIM_BATCH)
    stats.due += due.length
    for (let i = 0; i < due.length; i += CONCURRENCY) {
      const batch = due.slice(i, i + CONCURRENCY)
      const results = await Promise.all(batch.map(deliver))
      results.forEach((result, j) => {
        if (result === 'retry') retry.push(batch[j])
        else stats[result]++
      })
    }
    if (due.length < CLAIM_BATCH) break
  }

  // Échec temporaire (réseau, service push indisponible) : nouvel essai au passage suivant, jusqu'à MAX_LATE_MS.
  // Remis en file seulement maintenant, pour ne pas les réclamer à nouveau dans la boucle ci-dessus.
  await store.requeue(retry)
  stats.failed = retry.length

  await store.recordCronRun(started)
  return json({ ...stats, removedDevices: gone.size })
})
