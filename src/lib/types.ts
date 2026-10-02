export type Freq = 'daily' | 'weekly' | 'monthly' | 'yearly'

export interface Recurrence {
  freq: Freq
  /** Toutes les N unités (1 = chaque jour/semaine/mois/année). */
  interval: number
  /** Jours de la semaine (0 = dimanche … 6 = samedi), uniquement pour `weekly`. */
  byWeekday?: number[]
  /** Date de fin incluse, au format yyyy-MM-dd. */
  until?: string
}

export const NOTE_COLORS = ['coral', 'sand', 'sage', 'sky', 'lavender', 'rose'] as const
export type NoteColor = (typeof NOTE_COLORS)[number]

export interface Note {
  id: string
  title: string
  body: string
  tags: string[]
  pinned: boolean
  color?: NoteColor
  /** Date de la note dans l'agenda (yyyy-MM-dd). Sans date, la note n'apparaît pas dans l'agenda. */
  date?: string
  /** Heure optionnelle (HH:mm). */
  time?: string
  location?: string
  recurrence?: Recurrence
  /** Rappel en minutes avant l'événement, utilisé lors de l'ajout au Calendrier. */
  reminder?: number
  /** Occurrences marquées comme faites (yyyy-MM-dd). */
  doneDates: string[]
  /** Présent si la note est dans la corbeille. */
  deletedAt?: number
  createdAt: number
  updatedAt: number
}
