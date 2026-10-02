import { CalendarDays, ListChecks, MapPin, Pin, Repeat } from 'lucide-react'
import { CHECK_RE, checklistProgress, toggleLine } from '../lib/checklist'
import { db, restoreNote, toggleDone, trashNote } from '../lib/db'
import { describeRecurrence, fmt, fromKey, nextOccurrence, relativeDay } from '../lib/dates'
import type { Note } from '../lib/types'
import { SwipeToDelete } from './SwipeToDelete'
import { useToast } from './Toast'

const PREVIEW_LINES = 6

interface Props {
  note: Note
  onOpen: (id: string) => void
  /** Vue agenda : jour de l'occurrence affichée, pour la case « fait ». */
  dayKey?: string
  /** Afficher la date de l'occurrence (ex. section « en retard »). */
  showDate?: boolean
}

export function NoteCard({ note, onOpen, dayKey, showDate }: Props) {
  const lines = note.body.split('\n')
  const preview = lines.slice(0, PREVIEW_LINES)
  const done = dayKey ? note.doneDates.includes(dayKey) : false
  const progress = checklistProgress(note.body)
  const next = !dayKey && note.date ? nextOccurrence(note, new Date()) : null
  const toast = useToast()

  async function remove() {
    await trashNote(note.id)
    toast(note.recurrence ? 'Note et ses répétitions supprimées' : 'Note placée dans la corbeille', {
      label: 'Annuler',
      run: () => restoreNote(note.id),
    })
  }

  function onToggleLine(index: number) {
    db.notes.update(note.id, { body: toggleLine(note.body, index), updatedAt: Date.now() })
  }

  return (
    <SwipeToDelete id={note.id} onDelete={remove}>
      <article
        className={`card${note.color ? ` card--${note.color}` : ''}${done ? ' card--done' : ''}`}
        onClick={() => onOpen(note.id)}
      >
        <div className="card__head">
          {dayKey && (
            <label className="round-check" onClick={(e) => e.stopPropagation()}>
              <input type="checkbox" checked={done} onChange={() => toggleDone(note, dayKey)} aria-label="Marquer comme fait" />
              <span />
            </label>
          )}
          <div className="card__titles">
            {dayKey && (note.time || showDate) && (
              <span className="card__time">
                {showDate && note.date ? relativeDay(fromKey(note.date)) : ''}
                {showDate && note.time ? ' · ' : ''}
                {note.time}
              </span>
            )}
            <h3 className="card__title">{note.title || <span className="muted">Sans titre</span>}</h3>
          </div>
          {note.pinned && <Pin size={14} className="card__pin" aria-label="Épinglée" />}
        </div>

        {preview.some((l) => l.trim()) && (
          <div className="card__body">
            {preview.map((line, i) => {
              const m = line.match(CHECK_RE)
              if (!m) return <div key={i}>{line || ' '}</div>
              const checked = m[2].toLowerCase() === 'x'
              return (
                <label key={i} className={`check${checked ? ' check--on' : ''}`} onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={checked} onChange={() => onToggleLine(i)} />
                  <span>{m[3]}</span>
                </label>
              )
            })}
            {lines.length > PREVIEW_LINES && <div className="muted">…</div>}
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
          {!next && !dayKey && note.date && !note.recurrence && (
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
