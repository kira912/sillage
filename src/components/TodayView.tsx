import { addDays } from 'date-fns'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronRight, ShoppingCart } from 'lucide-react'
import { useMemo } from 'react'
import { activeNotes } from '../lib/db'
import { agendaRange, byTime, occursOn, relativeDay, toKey } from '../lib/dates'
import { isShoppingList, parseItems } from '../lib/shopping'
import type { Note } from '../lib/types'
import { useMinute, useToday } from '../lib/today'
import { NoteCard } from './NoteCard'
import { Section } from './Section'
import { Track } from './Track'

const UPCOMING_DAYS = 7

interface Props {
  onOpen: (id: string) => void
  onCreate: () => void
  onOpenShopping: () => void
}

export function TodayView({ onOpen, onCreate, onOpenShopping }: Props) {
  const notes = useLiveQuery(activeNotes, [])
  const today = useToday()
  const now = useMinute()
  const todayKey = toKey(today)

  const { overdue, todayList, upcoming, pinned, shopping } = useMemo(() => {
    const all = notes ?? []
    const dated = all.filter((n) => n.date)
    return {
      overdue: dated
        .filter((n) => !n.recurrence && n.date! < todayKey && !n.doneDates.includes(n.date!))
        .sort((a, b) => a.date!.localeCompare(b.date!) || byTime(a, b)),
      todayList: dated.filter((n) => occursOn(n, today)).sort(byTime),
      upcoming: agendaRange(dated, addDays(today, 1), UPCOMING_DAYS),
      pinned: all.filter((n) => n.pinned && !n.date),
      shopping: all.find(isShoppingList),
    }
  }, [notes, today, todayKey])

  if (!notes) return null

  const remaining = todayList.filter((n) => !n.doneDates.includes(todayKey)).length

  return (
    <section className="view">
      <p className="view__lede">
        {todayList.length === 0
          ? 'Rien de prévu aujourd’hui.'
          : remaining === 0
            ? 'Tout est fait pour aujourd’hui.'
            : `Encore ${remaining} chose${remaining > 1 ? 's' : ''} à faire aujourd’hui.`}
      </p>

      {/* Une liste de courses datée apparaît sur la ligne de son jour ; sinon, ce rappel suffit. */}
      {shopping && !shopping.date && <ShoppingReminder note={shopping} onOpen={onOpenShopping} />}

      {overdue.length > 0 && (
        <Section title="En retard" variant="day" tone="warn" bare>
          <Track stops={overdue.map((n) => ({ note: n, dayKey: n.date! }))} onOpen={onOpen} late />
        </Section>
      )}

      {todayList.length > 0 && <Track stops={todayList.map((n) => ({ note: n, dayKey: todayKey }))} onOpen={onOpen} now={now} />}

      {upcoming.map(({ day, notes: list }) => (
        <Section key={toKey(day)} title={relativeDay(day, today)} variant="day" bare>
          <Track stops={list.map((n) => ({ note: n, dayKey: toKey(day) }))} onOpen={onOpen} />
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
          <p className="welcome__title chart-title">Bienvenue dans Sillage</p>
          <p className="muted">
            Écrivez une note, une liste de courses, ou ajoutez un rendez-vous avec une date : il apparaîtra ici, sur la
            ligne de sa journée. Les choses qui reviennent (sport, poubelles, factures…) peuvent se répéter.
          </p>
          <button className="btn btn--primary" onClick={onCreate}>Écrire une note</button>
        </div>
      )}
    </section>
  )
}

/** Liste de courses sans date : rappel discret tant qu'il reste des articles à acheter. */
function ShoppingReminder({ note, onOpen }: { note: Note; onOpen: () => void }) {
  const toBuy = parseItems(note.body).filter((i) => !i.checked)
  if (!toBuy.length) return null
  const preview = toBuy.slice(0, 4).map((i) => i.name).join(', ') + (toBuy.length > 4 ? '…' : '')
  return (
    <button className="shop-card" onClick={onOpen}>
      <span className="shop-card__icon"><ShoppingCart size={18} /></span>
      <span className="shop-card__text">
        <span className="shop-card__title">
          {toBuy.length} article{toBuy.length > 1 ? 's' : ''} à acheter
        </span>
        <span className="shop-card__preview">{preview}</span>
      </span>
      <ChevronRight size={18} className="muted" />
    </button>
  )
}
