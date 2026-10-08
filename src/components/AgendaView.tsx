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
import { byTime, fmt, fromKey, nextOccurrence, occursOn, relativeDay, toKey } from '../lib/dates'
import { useMinute, useToday } from '../lib/today'
import type { Note } from '../lib/types'
import { Section } from './Section'
import { Segmented } from './Segmented'
import { Track, type Stop } from './Track'

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
      <Segmented
        label="Affichage"
        block
        value={mode}
        onChange={onMode}
        options={[
          ['calendar', 'Calendrier'],
          ['list', 'Toutes les dates'],
        ]}
      />
      {mode === 'calendar' ? <CalendarMode dated={dated} {...props} /> : <ListMode dated={dated} onOpen={props.onOpen} />}
    </section>
  )
}

/** Toutes les notes datées, jour par jour : à venir (prochaine occurrence), puis passées (les plus récentes d'abord). */
function ListMode({ dated, onOpen }: { dated: Note[]; onOpen: (id: string) => void }) {
  const today = useToday()
  const { upcoming, past } = useMemo(() => {
    const upcoming: Stop[] = []
    const past: Stop[] = []
    for (const note of dated) {
      const next = nextOccurrence(note, today)
      if (next) upcoming.push({ note, dayKey: toKey(next) })
      else past.push({ note, dayKey: note.date! })
    }
    upcoming.sort((a, b) => a.dayKey.localeCompare(b.dayKey) || byTime(a.note, b.note))
    past.sort((a, b) => b.dayKey.localeCompare(a.dayKey) || byTime(a.note, b.note))
    return { upcoming: groupByDay(upcoming), past: groupByDay(past) }
  }, [dated, today])

  if (dated.length === 0) return <p className="empty">Aucune note datée pour l’instant.<br />Touchez + pour en ajouter une.</p>

  return (
    <>
      {upcoming.map(([dayKey, stops]) => (
        <Section key={dayKey} title={relativeDay(fromKey(dayKey), today)} variant="day" bare>
          <Track stops={stops} onOpen={onOpen} />
        </Section>
      ))}
      {past.length > 0 && <h2 className="section__title">Passées</h2>}
      {past.map(([dayKey, stops]) => (
        <Section key={dayKey} title={relativeDay(fromKey(dayKey), today)} variant="day" bare>
          <Track stops={stops} onOpen={onOpen} />
        </Section>
      ))}
    </>
  )
}

/** Regroupe par jour des arrêts déjà triés, en gardant leur ordre. */
function groupByDay(stops: Stop[]): [string, Stop[]][] {
  const groups = new Map<string, Stop[]>()
  for (const stop of stops) groups.set(stop.dayKey, [...(groups.get(stop.dayKey) ?? []), stop])
  return [...groups]
}

function CalendarMode({ dated, selected, onSelect, onOpen }: Omit<Props, 'mode' | 'onMode'> & { dated: Note[] }) {
  const [month, setMonth] = useState(() => startOfMonth(selected))
  const today = useToday()
  const now = useMinute()
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
          <h2 className="cal__title chart-title" aria-live="polite">{fmt(month, 'MMMM yyyy')}</h2>
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
            <div key={i} className="cal__dow" aria-hidden="true">{d}</div>
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
              <button
                key={key}
                className={cls}
                onClick={() => onSelect(d)}
                aria-pressed={isSameDay(d, selected)}
                aria-label={`${fmt(d, 'EEEE d MMMM')}${count ? `, ${count} note${count > 1 ? 's' : ''}` : ''}`}
              >
                <span className="cal__num">{d.getDate()}</span>
                <span className="cal__dots" aria-hidden="true">
                  {Array.from({ length: Math.min(count, 3) }, (_, i) => <i key={i} />)}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <Section title={relativeDay(selected, today)} variant="day" bare>
        {dayNotes.length === 0 ? (
          <p className="empty">Rien de prévu ce jour-là.<br />Touchez + pour ajouter quelque chose.</p>
        ) : (
          <Track
            stops={dayNotes.map((n) => ({ note: n, dayKey: toKey(selected) }))}
            onOpen={onOpen}
            now={isSameDay(selected, today) ? now : undefined}
          />
        )}
      </Section>
    </>
  )
}
