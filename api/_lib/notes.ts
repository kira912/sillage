/** Notes extraites par l'IA, telles que renvoyées à l'app (après validation). */
export interface DraftNote {
  title: string
  body: string
  tags: string[]
  date?: string
  time?: string
  recurrence?: {
    freq: 'daily' | 'weekly' | 'monthly' | 'yearly'
    interval: number
    byWeekday?: number[]
    until?: string
  }
  reminder?: number
}

const FREQS = ['daily', 'weekly', 'monthly', 'yearly'] as const
const REMINDERS = [0, 10, 30, 60, 120, 1440]
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * Schéma imposé au modèle (structured outputs). Pas de champs optionnels ni de null :
 * une valeur vide ("", "none", -1) signifie « absent », ce qui garde le schéma simple et strict.
 */
export const NOTES_SCHEMA = {
  type: 'object',
  properties: {
    notes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Titre court, première lettre en majuscule' },
          body: { type: 'string', description: 'Détails ou liste "- [ ] élément" par ligne ; "" si rien' },
          tags: { type: 'array', items: { type: 'string' } },
          date: { type: 'string', description: 'YYYY-MM-DD, ou "" sans date' },
          time: { type: 'string', description: 'HH:mm (24 h), ou "" sans heure' },
          recurrence: {
            type: 'object',
            properties: {
              freq: { type: 'string', enum: ['none', ...FREQS] },
              interval: { type: 'integer' },
              weekdays: { type: 'array', items: { type: 'integer' }, description: '0 = dimanche … 6 = samedi' },
              until: { type: 'string', description: 'YYYY-MM-DD, ou ""' },
            },
            required: ['freq', 'interval', 'weekdays', 'until'],
            additionalProperties: false,
          },
          reminder_minutes: {
            type: 'integer',
            description: '-1 = pas de rappel ; sinon minutes avant (0, 10, 30, 60, 120, 1440)',
          },
        },
        required: ['title', 'body', 'tags', 'date', 'time', 'recurrence', 'reminder_minutes'],
        additionalProperties: false,
      },
    },
  },
  required: ['notes'],
  additionalProperties: false,
} as const

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** Revalide la sortie du modèle : on ne fait confiance qu'à ce qui correspond exactement au format attendu. */
export function sanitizeNotes(raw: unknown): DraftNote[] {
  const list = (raw as { notes?: unknown })?.notes
  if (!Array.isArray(list)) return []

  return list.slice(0, 20).flatMap((item): DraftNote[] => {
    if (!item || typeof item !== 'object') return []
    const n = item as Record<string, unknown>
    const title = str(n.title, 200)
    const body = str(n.body, 5000)
    if (!title && !body) return []

    const tags = Array.isArray(n.tags)
      ? [...new Set(n.tags.map((t) => str(t, 40).replace(/^#/, '').toLowerCase()).filter(Boolean))].slice(0, 5)
      : []

    const date = DATE_RE.test(str(n.date, 10)) ? str(n.date, 10) : undefined
    const time = date && TIME_RE.test(str(n.time, 5)) ? str(n.time, 5) : undefined

    let recurrence: DraftNote['recurrence']
    const r = n.recurrence as Record<string, unknown> | undefined
    if (date && r && FREQS.includes(r.freq as (typeof FREQS)[number])) {
      const interval = Number.isInteger(r.interval) ? Math.min(Math.max(r.interval as number, 1), 365) : 1
      const weekdays = Array.isArray(r.weekdays)
        ? [...new Set(r.weekdays.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))]
        : []
      const until = DATE_RE.test(str(r.until, 10)) && str(r.until, 10) >= date ? str(r.until, 10) : undefined
      recurrence = {
        freq: r.freq as (typeof FREQS)[number],
        interval,
        ...(r.freq === 'weekly' && weekdays.length ? { byWeekday: weekdays } : {}),
        ...(until ? { until } : {}),
      }
    }

    const reminder = date && REMINDERS.includes(n.reminder_minutes as number) ? (n.reminder_minutes as number) : undefined

    return [{ title, body, tags, date, time, recurrence, reminder }]
  })
}
