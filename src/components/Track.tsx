import { ListChecks, MapPin, Repeat, Users } from 'lucide-react'
import { Fragment, type CSSProperties } from 'react'
import { CHECK_RE, checklistProgress } from '../lib/checklist'
import { toggleDone } from '../lib/db'
import { describeRecurrence, fromKey, relativeDay } from '../lib/dates'
import { plainText } from '../lib/richtext'
import { isShoppingList, parseItems } from '../lib/shopping'
import type { Note } from '../lib/types'
import { NewBy } from './NoteCard'
import { RichLine } from './RichText'
import { SwipeToDelete } from './SwipeToDelete'
import { useTrashNote } from './useTrashNote'

/** Une occurrence de note un jour donné. */
export interface Stop {
  note: Note
  dayKey: string
}

interface Props {
  /** Arrêts déjà triés : ceux qui ont une heure d'abord. */
  stops: Stop[]
  onOpen: (id: string) => void
  /** Heure actuelle (HH:mm) : place la balise « maintenant » parmi les arrêts qui ont une heure. */
  now?: string
  /** Arrêts en retard : la date prévue est rappelée. */
  late?: boolean
}

/**
 * La ligne d'une journée : une heure, un point, un titre. Le point est la case « fait » ; ce qui est fait
 * colore la ligne, comme le sillage laissé derrière soi.
 */
export function Track({ stops, onOpen, now, late }: Props) {
  const timed = stops.filter((s) => s.note.time).length
  let nowIndex = -1
  if (now && timed) {
    const next = stops.findIndex((s) => s.note.time && s.note.time > now)
    nowIndex = next === -1 ? timed : next
  }

  return (
    <div className="track">
      {stops.map((s, i) => (
        <Fragment key={`${s.note.id}:${s.dayKey}`}>
          {i === nowIndex && <NowMarker time={now!} />}
          <StopRow stop={s} onOpen={onOpen} late={late} />
        </Fragment>
      ))}
      {nowIndex === stops.length && <NowMarker time={now!} />}
    </div>
  )
}

function NowMarker({ time }: { time: string }) {
  return (
    <div className="now" role="separator" aria-label={`Maintenant, ${time}`}>
      <span className="now__time" aria-hidden="true">{time}</span>
      <span className="now__mark" aria-hidden="true" />
      <span className="now__rule" aria-hidden="true" />
    </div>
  )
}

const stopTitle = (note: Note) => (isShoppingList(note) ? 'Faire les courses' : plainText(note.title) || 'Sans titre')

function StopRow({ stop: { note, dayKey }, onOpen, late }: { stop: Stop; onOpen: (id: string) => void; late?: boolean }) {
  const trash = useTrashNote()
  const done = note.doneDates.includes(dayKey)
  const title = stopTitle(note)

  const row = (
    <div
      className={`stop${done ? ' stop--done' : ''}`}
      style={note.color ? ({ '--dot': `var(--c-${note.color}-dot)` } as CSSProperties) : undefined}
    >
      <span className="stop__time">{note.time}</span>
      <label className="stop__check">
        <input type="checkbox" checked={done} onChange={() => toggleDone(note, dayKey)} aria-label={`Marquer « ${title} » comme fait`} />
        <span className="stop__dot" />
      </label>
      <button className="stop__open" onClick={() => onOpen(note.id)}>
        {note.unread && <NewBy name={note.editedBy} />}
        <span className="stop__title">{note.title && !isShoppingList(note) ? <RichLine text={note.title} /> : title}</span>
        <StopMeta note={note} lateSince={late ? dayKey : undefined} />
      </button>
    </div>
  )

  // La liste de courses ne se supprime pas d'un geste : elle est partagée et sert à tout l'espace.
  if (isShoppingList(note)) return row
  return (
    <SwipeToDelete id={`${note.id}:${dayKey}`} onDelete={() => trash(note)}>
      {row}
    </SwipeToDelete>
  )
}

function StopMeta({ note, lateSince }: { note: Note; lateSince?: string }) {
  const parts = []
  if (lateSince) {
    parts.push(<span key="late" className="stop__late">Prévu {relativeDay(fromKey(lateSince)).toLowerCase()}</span>)
  }
  if (isShoppingList(note)) {
    const toBuy = parseItems(note.body).filter((i) => !i.checked)
    if (toBuy.length) {
      parts.push(<span key="count" className="stop__count">{toBuy.length} article{toBuy.length > 1 ? 's' : ''}</span>)
      parts.push(<span key="preview" className="stop__preview">{toBuy.map((i) => i.name).join(', ')}</span>)
    }
  } else {
    const progress = checklistProgress(note.body)
    if (progress.total) {
      parts.push(<span key="list"><ListChecks size={13} /> {progress.done}/{progress.total}</span>)
    } else {
      const firstLine = note.body.split('\n').find((l) => l.trim())
      if (firstLine) parts.push(<span key="preview" className="stop__preview">{plainText(firstLine.replace(CHECK_RE, '$3'))}</span>)
    }
  }
  if (note.recurrence) parts.push(<span key="rec"><Repeat size={13} /> {describeRecurrence(note.recurrence)}</span>)
  if (note.location) parts.push(<span key="loc"><MapPin size={13} /> {note.location}</span>)
  if (note.shared && !isShoppingList(note)) parts.push(<span key="shared"><Users size={13} /><span className="sr-only">Partagée</span></span>)

  return parts.length ? <span className="stop__meta">{parts}</span> : null
}
