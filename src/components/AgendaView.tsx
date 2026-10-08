import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { activeNotes } from '../lib/db'
import { byTime, fmt, nextOccurrence, occursOn, relativeDay, toKey } from '../lib/dates'
import { useToday } from '../lib/today'
import type { Note } from '../lib/types'
import { NoteCard } from './NoteCard'
import { Section } from './Section'

export type AgendaMode = 'calendar' | 'list'

interface Props {
  mode: AgendaMode
  onMode: (m: AgendaMode) => void
  selected: Date
  onSelect: (d: Date) => void
  onOpen: (id: string) => void
}

export function AgendaView({ mode, onMode, ...props }: Props) {
  const notes = useLiveQuery(activeNotes, [])
  const dated = useMemo(() => (notes ?? []).filter((n) => n.date), [notes])

  return (
    <section className="view">
      <div className="segmented agenda__mode" role="radiogroup" aria-label="Affichage">
        <button role="radio" aria-checked={mode === 'calendar'} className={mode === 'calendar' ? 'on' : ''} onClick={() => onMode('calendar')}>
          Calendrier
        </button>
        <button role="radio" aria-checked={mode === 'list'} className={mode === 'list' ? 'on' : ''} onClick={() => onMode('list')}>
          Toutes les dates
        </button>
      </div>
      {mode === 'calendar' ? <CalendarMode dated={dated} {...props} /> : <ListMode dated={dated} onOpen={props.onOpen} />}
    </section>
  )
}

/** Toutes les notes datées : à venir (par prochaine occurrence), puis passées (les plus récentes d'abord). */
function ListMode({ dated, onOpen }: { dated: Note[]; onOpen: (id: string) => void }) {
  const today = useToday()
  const { upcoming, past } = useMemo(() => {
    const withNext = dated.map((note) => ({ note, next: nextOccurrence(note, today) }))
    return {
      upcoming: withNext
        .filter((x) => x.next)
        .sort((a, b) => a.next!.getTime() - b.next!.getTime() || byTime(a.note, b.note))
        .map((x) => x.note),
      past: withNext
        .filter((x) => !x.next)
        .map((x) => x.note)
        .sort((a, b) => b.date!.localeCompare(a.date!) || byTime(a, b)),
    }
  }, [dated, today])

  if (dated.length === 0) return <p className="empty">Aucune note datée pour l’instant.<br />Touchez + pour ajouter quelque chose.</p>

  return (
    <>
      {upcoming.length > 0 && (
        <Section title="À venir">
          {upcoming.map((n) => <NoteCard key={n.id} note={n} onOpen={onOpen} />)}
        </Section>
      )}
      {past.length > 0 && (
        <Section title="Passées">
          {past.map((n) => <NoteCard key={n.id} note={n} onOpen={onOpen} />)}
        </Section>
      )}
    </>
  )
}

function CalendarMode({ dated, selected, onSelect, onOpen }: Omit<Props, 'mode' | 'onMode'> & { dated: Note[] }) {
  const [month, setMonth] = useState(() => startOfMonth(selected))
  const today = useToday()
  const touchX = useRef<number | null>(null)

  const days = useMemo(() => {
    const out: Date[] = []
    const end = endOfWeek(endOfMonth(month), { weekStartsOn: 1 })
    for (let d = startOfWeek(month, { weekStartsOn: 1 }); d <= end; d = addDays(d, 1)) out.push(d)
    return out
  }, [month])

  const countByDay = useMemo(() => {
    const map = new Map<string, number>()
    for (const d of days) {
      const c = dated.filter((n) => occursOn(n, d)).length
      if (c) map.set(toKey(d), c)
    }
    return map
  }, [dated, days])

  const dayNotes = useMemo(() => dated.filter((n) => occursOn(n, selected)).sort(byTime), [dated, selected])

  function goToday() {
    onSelect(today)
    setMonth(startOfMonth(today))
  }

  // Glisser à gauche / à droite sur le calendrier pour changer de mois.
  function onTouchEnd(x: number) {
    if (touchX.current === null) return
    const dx = x - touchX.current
    touchX.current = null
    if (Math.abs(dx) > 50) setMonth(addMonths(month, dx < 0 ? 1 : -1))
  }

  const isOnToday = isSameDay(selected, today) && isSameMonth(month, today)

  return (
    <>
      <div
        className="cal"
        onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
        onTouchEnd={(e) => onTouchEnd(e.changedTouches[0].clientX)}
      >
        <div className="cal__nav">
          <span className="cal__title">{fmt(month, 'MMMM yyyy')}</span>
          <div className="cal__buttons">
            {!isOnToday && (
              <button className="btn btn--small" onClick={goToday}>Aujourd’hui</button>
            )}
            <button className="icon-btn" onClick={() => setMonth(addMonths(month, -1))} aria-label="Mois précédent">
              <ChevronLeft size={20} />
            </button>
            <button className="icon-btn" onClick={() => setMonth(addMonths(month, 1))} aria-label="Mois suivant">
              <ChevronRight size={20} />
            </button>
          </div>
        </div>
        <div className="cal__grid">
          {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d, i) => (
            <div key={i} className="cal__dow">{d}</div>
          ))}
          {days.map((d) => {
            const key = toKey(d)
            const count = countByDay.get(key) ?? 0
            const cls = [
              'cal__day',
              !isSameMonth(d, month) && 'cal__day--out',
              isSameDay(d, today) && 'cal__day--today',
              isSameDay(d, selected) && 'cal__day--sel',
            ]
              .filter(Boolean)
              .join(' ')
            return (
              <button key={key} className={cls} onClick={() => onSelect(d)} aria-label={fmt(d, 'EEEE d MMMM')}>
                <span className="cal__num">{d.getDate()}</span>
                <span className="cal__dots">
                  {Array.from({ length: Math.min(count, 3) }, (_, i) => <i key={i} />)}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <h2 className="section__title">{relativeDay(selected, today)}</h2>
      {dayNotes.length === 0 ? (
        <p className="empty">Rien de prévu ce jour-là.<br />Touchez + pour ajouter quelque chose.</p>
      ) : (
        <div className="list">
          {dayNotes.map((n) => (
            <NoteCard key={n.id} note={n} onOpen={onOpen} dayKey={toKey(selected)} />
          ))}
        </div>
      )}
    </>
  )
}
