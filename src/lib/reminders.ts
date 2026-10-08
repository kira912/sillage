import { addDays, startOfDay } from 'date-fns'
import { fmt, occursOn, toKey } from './dates'
import { plainText } from './richtext'
import type { Note } from './types'

export interface ScheduledReminder {
  id: string
  /** Instant d'envoi, en millisecondes epoch. */
  at: number
  title: string
  body: string
}

/**
 * Fenêtre planifiée à l'avance : elle est recalculée à chaque ouverture de l'app ou modification.
 * Au-delà, sans ouverture de l'app, les rappels s'arrêtent (limites identiques côté serveur).
 */
export const HORIZON_DAYS = 60
const MAX_REMINDERS = 500

/**
 * Instant du rappel d'une occurrence. Mêmes règles que l'export Calendrier :
 * avec heure → N minutes avant ; journée entière → 9 h le jour même, ou 18 h la veille (≥ 1 jour).
 */
export function reminderTime(note: Note, day: Date): Date | null {
  if (note.reminder === undefined) return null
  if (note.time) {
    const [h, m] = note.time.split(':').map(Number)
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m)
    return new Date(start.getTime() - note.reminder * 60_000)
  }
  return note.reminder >= 1440
    ? new Date(day.getFullYear(), day.getMonth(), day.getDate() - 1, 18, 0)
    : new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0)
}

function describe(note: Note, day: Date, now: Date): string {
  const sameDay = toKey(day) === toKey(now)
  const when = note.time ? `${sameDay ? 'Aujourd’hui' : fmt(day, 'EEEE d MMMM')} à ${note.time}` : fmt(day, 'EEEE d MMMM')
  return [when.charAt(0).toUpperCase() + when.slice(1), note.location].filter(Boolean).join(' · ')
}

export function computeReminders(notes: Note[], now = new Date()): ScheduledReminder[] {
  const out: ScheduledReminder[] = []
  const first = startOfDay(now)
  // On regarde un jour de plus pour les rappels « la veille ».
  for (let i = 0; i <= HORIZON_DAYS + 1; i++) {
    const day = addDays(first, i)
    const key = toKey(day)
    for (const note of notes) {
      if (note.deletedAt || note.reminder === undefined || !occursOn(note, day)) continue
      if (note.doneDates.includes(key)) continue
      const at = reminderTime(note, day)
      if (!at || at <= now || at.getTime() > now.getTime() + HORIZON_DAYS * 86_400_000) continue
      out.push({ id: `${note.id}:${key}`, at: at.getTime(), title: plainText(note.title) || 'Rappel', body: describe(note, day, now) })
    }
  }
  return out.sort((a, b) => a.at - b.at).slice(0, MAX_REMINDERS)
}
