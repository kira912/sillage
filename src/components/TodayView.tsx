import { addDays } from 'date-fns'
import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { activeNotes } from '../lib/db'
import { agendaRange, byTime, fmt, occursOn, relativeDay, toKey } from '../lib/dates'
import { NoteCard } from './NoteCard'
import { Section } from './Section'

const UPCOMING_DAYS = 7

export function TodayView({ onOpen, onCreate }: { onOpen: (id: string) => void; onCreate: () => void }) {
  const notes = useLiveQuery(activeNotes, [])
  const today = useMemo(() => new Date(), [])
  const todayKey = toKey(today)

  const { overdue, todayList, upcoming, pinned } = useMemo(() => {
    const all = notes ?? []
    const dated = all.filter((n) => n.date)
    return {
      overdue: dated
        .filter((n) => !n.recurrence && n.date! < todayKey && !n.doneDates.includes(n.date!))
        .sort((a, b) => a.date!.localeCompare(b.date!)),
      todayList: dated.filter((n) => occursOn(n, today)).sort(byTime),
      upcoming: agendaRange(dated, addDays(today, 1), UPCOMING_DAYS),
      pinned: all.filter((n) => n.pinned && !n.date),
    }
  }, [notes, today, todayKey])

  if (!notes) return null

  const remaining = todayList.filter((n) => !n.doneDates.includes(todayKey)).length

  return (
    <section className="view">
      <div className="hello">
        <p className="hello__date">{fmt(today, 'EEEE d MMMM')}</p>
        <p className="muted">
          {todayList.length === 0
            ? 'Rien de prévu aujourd’hui.'
            : remaining === 0
              ? 'Tout est fait pour aujourd’hui 🎉'
              : `${remaining} chose${remaining > 1 ? 's' : ''} à faire aujourd’hui`}
        </p>
      </div>

      {overdue.length > 0 && (
        <Section title="En retard" tone="warn">
          {overdue.map((n) => (
            <NoteCard key={n.id} note={n} onOpen={onOpen} dayKey={n.date} showDate />
          ))}
        </Section>
      )}

      {todayList.length > 0 && (
        <Section title="Aujourd’hui">
          {todayList.map((n) => (
            <NoteCard key={n.id} note={n} onOpen={onOpen} dayKey={todayKey} />
          ))}
        </Section>
      )}

      {upcoming.map(({ day, notes: list }) => (
        <Section key={toKey(day)} title={relativeDay(day, today)}>
          {list.map((n) => (
            <NoteCard key={n.id} note={n} onOpen={onOpen} dayKey={toKey(day)} />
          ))}
        </Section>
      ))}

      {pinned.length > 0 && (
        <Section title="Épinglées">
          {pinned.map((n) => (
            <NoteCard key={n.id} note={n} onOpen={onOpen} />
          ))}
        </Section>
      )}

      {notes.length === 0 && (
        <div className="welcome">
          <p className="welcome__title">Bienvenue dans Sillage</p>
          <p className="muted">
            Écrivez une note, une liste de courses, ou ajoutez un rendez-vous avec une date. Les choses qui reviennent
            (sport, poubelles, factures…) peuvent se répéter automatiquement.
          </p>
          <button className="btn btn--primary" onClick={onCreate}>Créer ma première note</button>
        </div>
      )}
    </section>
  )
}
