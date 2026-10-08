import { CalendarDays, ChevronDown, ChevronUp, ListChecks, MapPin, Pin, Repeat, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { CHECK_RE, checklistProgress, toggleLine } from '../lib/checklist'
import { db } from '../lib/db'
import { describeRecurrence, fmt, fromKey, nextOccurrence, relativeDay } from '../lib/dates'
import { useToday } from '../lib/today'
import type { Note } from '../lib/types'
import { RichLine } from './RichText'
import { SwipeToDelete } from './SwipeToDelete'
import { useTrashNote } from './useTrashNote'

const PREVIEW_LINES = 6

interface Props {
  note: Note
  onOpen: (id: string) => void
}

/** Une note comme objet : titre, aperçu (cases cochables sans ouvrir), puis ses informations. */
export function NoteCard({ note, onOpen }: Props) {
  const lines = note.body.split('\n')
  // Une longue liste se déplie dans la carte : on peut cocher jusqu'au bout sans ouvrir l'éditeur.
  const [expanded, setExpanded] = useState(false)
  const hidden = lines.length - PREVIEW_LINES
  const preview = expanded ? lines : lines.slice(0, PREVIEW_LINES)
  const progress = checklistProgress(note.body)
  const today = useToday()
  const next = useMemo(() => (note.date ? nextOccurrence(note, today) : null), [note, today])
  const trash = useTrashNote()

  function onToggleLine(index: number) {
    db.notes.update(note.id, { body: toggleLine(note.body, index), updatedAt: Date.now() })
  }

  return (
    <SwipeToDelete id={note.id} onDelete={() => trash(note)}>
      <article className={`card${note.color ? ` card--${note.color}` : ''}`}>
        <div className="card__head">
          <h3 className="card__titles">
            <button className="card__open card__title" onClick={() => onOpen(note.id)}>
              {note.title ? <RichLine text={note.title} /> : <span className="muted">Sans titre</span>}
            </button>
          </h3>
          {note.shared && <Users size={15} className="card__shared" role="img" aria-label="Partagée" aria-hidden={false} />}
          {note.pinned && <Pin size={14} className="card__pin" role="img" aria-label="Épinglée" aria-hidden={false} />}
        </div>

        {preview.some((l) => l.trim()) && (
          <div className="card__body">
            {preview.map((line, i) => {
              const m = line.match(CHECK_RE)
              if (!m) return <div key={i}>{line ? <RichLine text={line} /> : ' '}</div>
              const checked = m[2].toLowerCase() === 'x'
              return (
                <label key={i} className={`check${checked ? ' check--on' : ''}`} onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={checked} onChange={() => onToggleLine(i)} />
                  <span><RichLine text={m[3]} /></span>
                </label>
              )
            })}
            {hidden > 0 && (
              <button
                className="card__more"
                onClick={(e) => {
                  e.stopPropagation()
                  setExpanded(!expanded)
                }}
                aria-expanded={expanded}
              >
                {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                {expanded ? 'Réduire' : `Afficher ${hidden} ligne${hidden > 1 ? 's' : ''} de plus`}
              </button>
            )}
          </div>
        )}

        <div className="card__meta">
          {progress.total > 0 && (
            <span className={`badge${progress.done === progress.total ? ' badge--ok' : ''}`}>
              <ListChecks size={13} /> {progress.done}/{progress.total}
            </span>
          )}
          {note.recurrence && (
            <span className="badge">
              <Repeat size={13} /> {describeRecurrence(note.recurrence)}
            </span>
          )}
          {next && (
            <span className="badge">
              <CalendarDays size={13} /> {relativeDay(next)}
              {note.time ? ` · ${note.time}` : ''}
            </span>
          )}
          {!next && note.date && !note.recurrence && (
            <span className="badge badge--past">
              <CalendarDays size={13} /> {fmt(fromKey(note.date), 'd MMM yyyy')}
            </span>
          )}
          {note.location && (
            <span className="badge">
              <MapPin size={13} /> {note.location}
            </span>
          )}
          {note.tags.map((t) => (
            <span key={t} className="tag">#{t}</span>
          ))}
        </div>
      </article>
    </SwipeToDelete>
  )
}
