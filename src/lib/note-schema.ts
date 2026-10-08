import { NOTE_COLORS, type Freq, type Note, type NoteColor, type Recurrence } from './types'

/**
 * Validation des notes venues d'ailleurs (autres membres de l'espace partagé, fichier de sauvegarde) :
 * une note mal formée enregistrée en local ferait planter l'app à chaque ouverture. On ne garde que
 * les champs au bon format ; une note sans identifiant, titre ou texte valides est rejetée.
 */

const FREQS: readonly Freq[] = ['daily', 'weekly', 'monthly', 'yearly']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

type Raw = Record<string, unknown>

const isRecord = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
const date = (v: unknown) => (typeof v === 'string' && DATE_RE.test(v) ? v : undefined)
const time = (v: unknown) => (typeof v === 'string' && TIME_RE.test(v) ? v : undefined)
const timestamp = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined)
const strings = (v: unknown, keep: (s: string) => boolean = () => true) =>
  Array.isArray(v) ? [...new Set(v.filter((s): s is string => typeof s === 'string' && keep(s)))] : []

function recurrence(v: unknown): Recurrence | undefined {
  if (!isRecord(v) || !FREQS.includes(v.freq as Freq)) return undefined
  const interval = Number.isInteger(v.interval) && (v.interval as number) >= 1 ? (v.interval as number) : 1
  const byWeekday = Array.isArray(v.byWeekday)
    ? [...new Set(v.byWeekday.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))]
    : []
  const until = date(v.until)
  return {
    freq: v.freq as Freq,
    interval,
    ...(byWeekday.length ? { byWeekday } : {}),
    ...(until ? { until } : {}),
    ...(v.weekendToMonday === true ? { weekendToMonday: true as const } : {}),
  }
}

/** Renvoie une note valide, ou `null`. Si `expectedId` est donné, l'identifiant doit lui correspondre. */
export function sanitizeNote(raw: unknown, expectedId?: string): Note | null {
  if (!isRecord(raw)) return null
  const id = str(raw.id)
  const title = str(raw.title)
  const body = str(raw.body)
  if (!id || title === undefined || body === undefined) return null
  if (expectedId !== undefined && id !== expectedId) return null

  const now = Date.now()
  const noteDate = date(raw.date)
  const optional: Partial<Note> = {
    color: NOTE_COLORS.includes(raw.color as NoteColor) ? (raw.color as NoteColor) : undefined,
    date: noteDate,
    // Heure, récurrence et rappel n'ont de sens qu'avec une date (même règle que l'éditeur).
    time: noteDate ? time(raw.time) : undefined,
    location: str(raw.location) || undefined,
    recurrence: noteDate ? recurrence(raw.recurrence) : undefined,
    reminder: noteDate && typeof raw.reminder === 'number' && Number.isInteger(raw.reminder) && raw.reminder >= 0 ? raw.reminder : undefined,
    deletedAt: timestamp(raw.deletedAt),
    shared: raw.shared === true ? true : undefined,
    editedBy: str(raw.editedBy),
  }

  const note: Note = {
    id,
    title,
    body,
    tags: strings(raw.tags, (t) => t.trim() !== ''),
    pinned: raw.pinned === true,
    doneDates: strings(raw.doneDates, (d) => DATE_RE.test(d)),
    createdAt: timestamp(raw.createdAt) ?? now,
    updatedAt: timestamp(raw.updatedAt) ?? now,
  }
  // Champs absents plutôt qu'`undefined` : l'empreinte de synchronisation ne doit pas en dépendre.
  for (const [key, value] of Object.entries(optional)) if (value !== undefined) (note as unknown as Raw)[key] = value
  return note
}
