import { addDays, addHours, format } from 'date-fns'
import { fromKey } from './dates'
import type { Note } from './types'

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

/** Les lignes iCalendar ne doivent pas dépasser 75 caractères. */
const fold = (line: string) => line.match(/.{1,73}/gu)?.join('\r\n ') ?? line

function rrule(note: Note): string | null {
  const r = note.recurrence
  if (!r) return null
  const parts = [`FREQ=${r.freq.toUpperCase()}`, `INTERVAL=${Math.max(1, r.interval)}`]
  if (r.freq === 'weekly' && r.byWeekday?.length) parts.push(`BYDAY=${r.byWeekday.map((d) => BYDAY[d]).join(',')}`)
  // Le 31 du mois → dernier jour de chaque mois, comme dans l'app.
  if (r.freq === 'monthly' && note.date && fromKey(note.date).getDate() === 31) parts.push('BYMONTHDAY=-1')
  if (r.until) parts.push(`UNTIL=${r.until.replace(/-/g, '')}${note.time ? 'T235959' : ''}`)
  return `RRULE:${parts.join(';')}`
}

/** Génère un fichier .ics pour ajouter la note au Calendrier du téléphone (avec rappel natif). */
export function noteToIcs(note: Note): string {
  if (!note.date) throw new Error('La note n’a pas de date')
  const day = fromKey(note.date)
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Sillage//FR', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT']
  lines.push(`UID:${note.id}@sillage`, `DTSTAMP:${format(new Date(), "yyyyMMdd'T'HHmmss")}`)

  if (note.time) {
    const [h, m] = note.time.split(':').map(Number)
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m)
    lines.push(`DTSTART:${format(start, "yyyyMMdd'T'HHmmss")}`, `DTEND:${format(addHours(start, 1), "yyyyMMdd'T'HHmmss")}`)
  } else {
    lines.push(`DTSTART;VALUE=DATE:${format(day, 'yyyyMMdd')}`, `DTEND;VALUE=DATE:${format(addDays(day, 1), 'yyyyMMdd')}`)
  }

  const rule = rrule(note)
  if (rule) lines.push(rule)
  lines.push(fold(`SUMMARY:${escape(note.title || 'Note')}`))
  if (note.body.trim()) lines.push(fold(`DESCRIPTION:${escape(note.body)}`))
  if (note.location) lines.push(fold(`LOCATION:${escape(note.location)}`))

  if (note.reminder !== undefined) {
    // Sans heure, le rappel est calculé depuis minuit : on le place la veille au soir / le matin même.
    const trigger = note.time ? `-PT${note.reminder}M` : note.reminder >= 1440 ? '-PT6H' : 'PT9H'
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `TRIGGER:${trigger}`, fold(`DESCRIPTION:${escape(note.title || 'Rappel')}`), 'END:VALARM')
  }

  lines.push('END:VEVENT', 'END:VCALENDAR')
  return lines.join('\r\n')
}

export async function addToCalendar(note: Note) {
  const name = `${(note.title || 'evenement').replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 40) || 'evenement'}.ics`
  const file = new File([noteToIcs(note)], name, { type: 'text/calendar' })

  // Sur iPhone, ouvrir un .ics propose directement « Ajouter au calendrier ».
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
