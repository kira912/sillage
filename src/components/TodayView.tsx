import { addDays } from 'date-fns'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronRight, Mic, ShoppingCart, Sparkles } from 'lucide-react'
import { useMemo } from 'react'
import { activeNotes } from '../lib/db'
import { agendaRange, byTime, fmt, fromKey, occursOn, relativeDay, toKey } from '../lib/dates'
import { isShoppingList, parseItems } from '../lib/shopping'
import type { Note } from '../lib/types'
import { useToday } from '../lib/today'
import { NoteCard } from './NoteCard'
import { Section } from './Section'

const UPCOMING_DAYS = 7

interface Props {
  onOpen: (id: string) => void
  onCreate: () => void
  onCapture: () => void
  onOpenShopping: () => void
}

export function TodayView({ onOpen, onCreate, onCapture, onOpenShopping }: Props) {
  const notes = useLiveQuery(activeNotes, [])
  const today = useToday()
  const todayKey = toKey(today)

  const { overdue, todayList, upcoming, pinned, shopping } = useMemo(() => {
    // La liste de courses a sa propre carte, en tête.
    const all = (notes ?? []).filter((n) => !isShoppingList(n))
    const dated = all.filter((n) => n.date)
    return {
      overdue: dated
        .filter((n) => !n.recurrence && n.date! < todayKey && !n.doneDates.includes(n.date!))
        .sort((a, b) => a.date!.localeCompare(b.date!)),
      todayList: dated.filter((n) => occursOn(n, today)).sort(byTime),
      upcoming: agendaRange(dated, addDays(today, 1), UPCOMING_DAYS),
      pinned: all.filter((n) => n.pinned && !n.date),
      shopping: notes?.find(isShoppingList),
    }
  }, [notes, today, todayKey])

  if (!notes) return null

  const remaining = todayList.filter((n) => !n.doneDates.includes(todayKey)).length

  return (
    <section className="view">
      <button className="capture-bar" onClick={onCapture}>
        <Sparkles size={18} />
        <span>Que faut-il retenir ?</span>
        <Mic size={18} className="capture-bar__mic" />
      </button>

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

      {shopping && <ShoppingCard note={shopping} todayKey={todayKey} onOpen={onOpenShopping} />}

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

/** Tâche « Faire les courses » : visible tant qu'il reste des articles à acheter ou qu'une date est prévue. */
function ShoppingCard({ note, todayKey, onOpen }: { note: Note; todayKey: string; onOpen: () => void }) {
  const toBuy = parseItems(note.body).filter((i) => !i.checked)
  if (!toBuy.length && !note.date) return null
  const late = !!note.date && note.date < todayKey
  const preview = toBuy.slice(0, 4).map((i) => i.name).join(', ') + (toBuy.length > 4 ? '…' : '')
  return (
    <button className="card shop-card" onClick={onOpen}>
      <span className="shop-card__icon"><ShoppingCart size={20} /></span>
      <span className="card__titles">
        {note.date && (
          <span className={`card__time${late ? ' card__time--late' : ''}`}>
            {relativeDay(fromKey(note.date))}
            {note.time ? ` · ${note.time}` : ''}
          </span>
        )}
        <span className="card__title">
          Faire les courses{toBuy.length ? ` · ${toBuy.length} article${toBuy.length > 1 ? 's' : ''}` : ''}
        </span>
        {preview && <span className="shop-card__preview">{preview}</span>}
      </span>
      <ChevronRight size={18} className="muted" />
    </button>
  )
}
