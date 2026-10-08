import {
  addDays,
  differenceInCalendarDays,
  differenceInCalendarMonths,
  differenceInCalendarWeeks,
  format,
  getDaysInMonth,
  parseISO,
} from 'date-fns'
import { fr } from 'date-fns/locale'
import type { Note, Recurrence } from './types'

export const toKey = (d: Date) => format(d, 'yyyy-MM-dd')
export const fromKey = (k: string) => parseISO(k)
export const fmt = (d: Date, pattern: string) => format(d, pattern, { locale: fr })

export const WEEKDAYS_SHORT = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam']
/** Ordre d'affichage lundi → dimanche. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]

/** Jour du mois à utiliser pour une récurrence mensuelle/annuelle (le 31 → dernier jour du mois). */
const clampDay = (startDay: number, d: Date) => Math.min(startDay, getDaysInMonth(d))

export const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6

/** Les week-ends sont reportés au lundi (sans effet sur `weekly`, qui choisit ses jours). */
const movesWeekends = (r?: Recurrence) => !!r?.weekendToMonday && r.freq !== 'weekly'

export function occursOn(note: Note, day: Date): boolean {
  if (!movesWeekends(note.recurrence)) return followsRule(note, day)
  if (isWeekend(day)) return false
  return followsRule(note, day) || (day.getDay() === 1 && (followsRule(note, addDays(day, -1)) || followsRule(note, addDays(day, -2))))
}

/** Le jour correspond-il à la règle de répétition, avant report des week-ends ? */
function followsRule(note: Note, day: Date): boolean {
  if (!note.date) return false
  const start = fromKey(note.date)
  const diff = differenceInCalendarDays(day, start)
  if (diff < 0) return false

  const r = note.recurrence
  if (!r) return diff === 0
  if (r.until && toKey(day) > r.until) return false

  const n = Math.max(1, r.interval || 1)
  switch (r.freq) {
    case 'daily':
      return diff % n === 0
    case 'weekly': {
      const weeks = differenceInCalendarWeeks(day, start, { weekStartsOn: 1 })
      if (weeks % n !== 0) return false
      const days = r.byWeekday?.length ? r.byWeekday : [start.getDay()]
      return days.includes(day.getDay())
    }
    case 'monthly': {
      if (differenceInCalendarMonths(day, start) % n !== 0) return false
      return day.getDate() === clampDay(start.getDate(), day)
    }
    case 'yearly': {
      const years = day.getFullYear() - start.getFullYear()
      if (years % n !== 0 || day.getMonth() !== start.getMonth()) return false
      return day.getDate() === clampDay(start.getDate(), day)
    }
  }
}

/** Prochaine occurrence à partir de `from` (incluse), sur un horizon d'un an. */
export function nextOccurrence(note: Note, from: Date): Date | null {
  if (!note.date) return null
  if (!note.recurrence) {
    const d = fromKey(note.date)
    return differenceInCalendarDays(d, from) >= 0 ? d : null
  }
  // Répétition terminée : rien à chercher (sans ce test, on parcourrait 400 jours pour rien à chaque affichage).
  // Une dernière occurrence un week-end tombe le lundi suivant, jusqu'à 2 jours après la fin.
  const until = note.recurrence.until && (movesWeekends(note.recurrence) ? toKey(addDays(fromKey(note.recurrence.until), 2)) : note.recurrence.until)
  if (until && until < toKey(from)) return null
  const start = fromKey(note.date)
  let day = differenceInCalendarDays(start, from) > 0 ? start : from
  const last = until ? fromKey(until) : null
  for (let i = 0; i < 400 && (!last || day <= last); i++, day = addDays(day, 1)) {
    if (occursOn(note, day)) return day
  }
  return null
}

export function describeRecurrence(r: Recurrence): string {
  const n = Math.max(1, r.interval || 1)
  let s: string
  switch (r.freq) {
    case 'daily':
      s = n === 1 ? 'Tous les jours' : `Tous les ${n} jours`
      break
    case 'weekly': {
      s = n === 1 ? 'Toutes les semaines' : `Toutes les ${n} semaines`
      if (r.byWeekday?.length) {
        const days = WEEK_ORDER.filter((d) => r.byWeekday!.includes(d)).map((d) => WEEKDAYS_SHORT[d])
        s += ` (${days.join(', ')})`
      }
      break
    }
    case 'monthly':
      s = n === 1 ? 'Tous les mois' : `Tous les ${n} mois`
      break
    case 'yearly':
      s = n === 1 ? 'Tous les ans' : `Tous les ${n} ans`
      break
  }
  if (movesWeekends(r)) s += r.freq === 'daily' && n === 1 ? ', sauf le week-end' : ', reporté au lundi le week-end'
  if (r.until) s += ` jusqu'au ${fmt(fromKey(r.until), 'd MMM yyyy')}`
  return s
}

/** « Aujourd'hui », « Demain », « Hier » ou « mercredi 8 octobre ». */
export function relativeDay(d: Date, today = new Date()): string {
  const diff = differenceInCalendarDays(d, today)
  if (diff === 0) return 'Aujourd’hui'
  if (diff === 1) return 'Demain'
  if (diff === -1) return 'Hier'
  const label = fmt(d, d.getFullYear() === today.getFullYear() ? 'EEEE d MMMM' : 'EEEE d MMMM yyyy')
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export const byTime = (a: Note, b: Note) => (a.time ?? '99').localeCompare(b.time ?? '99')

/** Occurrences regroupées par jour, de `from` sur `days` jours. */
export function agendaRange(notes: Note[], from: Date, days: number): { day: Date; notes: Note[] }[] {
  const out: { day: Date; notes: Note[] }[] = []
  for (let i = 0; i < days; i++) {
    const day = addDays(from, i)
    const list = notes.filter((n) => occursOn(n, day)).sort(byTime)
    if (list.length) out.push({ day, notes: list })
  }
  return out
}

export function describeReminder(minutes: number, hasTime: boolean): string {
  if (!hasTime) return minutes >= 1440 ? 'La veille à 18 h' : 'Le jour même à 9 h'
  if (minutes === 0) return "À l'heure de l'événement"
  if (minutes < 60) return `${minutes} min avant`
  if (minutes < 1440) return `${minutes / 60} h avant`
  return `${minutes / 1440} jour(s) avant`
}
