import { useLiveQuery } from 'dexie-react-hooks'
import { Bell, CalendarDays, Clock, Minus, Plus, ShoppingCart, Trash2, Users } from 'lucide-react'
import { useMemo, useRef, useState, type FormEvent } from 'react'
import { toggleLine } from '../lib/checklist'
import { db } from '../lib/db'
import { describeReminder, fromKey, relativeDay } from '../lib/dates'
import {
  SHOPPING_ID,
  addToList,
  describeQty,
  finishShopping,
  groupByAisle,
  parseItems,
  removeLine,
  setItemQty,
  suggestions,
  updateList,
  type Item,
} from '../lib/shopping'
import { useSpace } from '../lib/space'
import type { Note } from '../lib/types'
import { Picker, Row, SelectPicker } from './NoteEditor'
import { RecipeIdeas } from './RecipeIdeas'
import { useToast } from './Toast'

const REMINDERS_TIMED = [0, 30, 60, 120, 1440]
const REMINDERS_ALLDAY = [0, 1440]

export function ShoppingView({ onOpenSettings }: { onOpenSettings: () => void }) {
  // `null` tant que la liste n'existe pas encore : elle est créée au premier article ajouté.
  const list = useLiveQuery(async () => (await db.notes.get(SHOPPING_ID)) ?? null, [])
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const space = useSpace()
  const toast = useToast()

  const note = list && !list.deletedAt ? list : null
  const items = useMemo(() => parseItems(note?.body ?? ''), [note?.body])
  const toBuy = items.filter((i) => !i.checked)
  const inCart = items.filter((i) => i.checked)
  // Recalculées à chaque rendu : elles dépendent de la saisie et de l'historique local.
  const suggested = list === undefined ? [] : suggestions(items, input)

  if (list === undefined) return null

  async function add(text: string) {
    if (!text.trim()) return
    await addToList(text)
    setInput('')
    inputRef.current?.focus()
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    void add(input)
  }

  /** Suggestion touchée : remplace le mot en cours de saisie s'il y en a un. */
  function pick(name: string) {
    const parts = input.split(/[,;]/)
    parts.pop()
    void add([...parts, name].join(','))
  }

  const edit = (change: (n: Note) => Partial<Note>) => updateList(change)
  const toggle = (item: Item) => edit((n) => ({ body: toggleLine(n.body, item.line) }))

  async function finish() {
    const n = inCart.length
    await finishShopping()
    toast(n ? `Courses terminées : ${n} article${n > 1 ? 's' : ''} retiré${n > 1 ? 's' : ''} de la liste` : 'Courses terminées')
  }

  const reminderOptions = note?.time ? REMINDERS_TIMED : REMINDERS_ALLDAY

  return (
    <section className="view">
      <form className="shop-add" onSubmit={submit}>
        <input
          ref={inputRef}
          className="field"
          value={input}
          placeholder="Ajouter : lait, 2 baguettes, 500 g farine…"
          enterKeyHint="send"
          autoComplete="off"
          onChange={(e) => setInput(e.target.value)}
        />
        <button className="btn btn--primary shop-add__btn" disabled={!input.trim()} aria-label="Ajouter">
          <Plus size={20} />
        </button>
      </form>

      {suggested.length > 0 && (
        <div className="chips chips--scroll">
          {suggested.map((name) => (
            <button key={name} className="chip" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(name)}>
              + {name}
            </button>
          ))}
        </div>
      )}

      {toBuy.length === 0 && inCart.length === 0 ? (
        <div className="empty shop-empty">
          <ShoppingCart size={32} />
          <p>La liste est vide.</p>
          <p className="footnote">
            Séparez les articles par des virgules. Ajouter un article déjà présent augmente sa quantité.
          </p>
        </div>
      ) : toBuy.length === 0 ? (
        <p className="empty">Tout est dans le panier 🎉</p>
      ) : (
        groupByAisle(toBuy).map(({ aisle, items: group }) => (
          <div key={aisle} className="section">
            <h2 className="section__title">{aisle}</h2>
            <div className="group">
              {group.map((item) => (
                <ItemRow
                  key={`${item.line}:${item.name}`}
                  item={item}
                  onToggle={() => toggle(item)}
                  onQty={(qty) => edit((n) => ({ body: setItemQty(n.body, item, qty) }))}
                  onRemove={() => edit((n) => ({ body: removeLine(n.body, item.line) }))}
                />
              ))}
            </div>
          </div>
        ))
      )}

      {inCart.length > 0 && (
        <div className="section">
          <h2 className="section__title">Dans le panier · {inCart.length}</h2>
          <div className="group">
            {inCart.map((item) => (
              <ItemRow key={`${item.line}:${item.name}`} item={item} onToggle={() => toggle(item)} />
            ))}
          </div>
          <button className="btn btn--primary btn--block" onClick={finish}>
            Courses terminées
          </button>
        </div>
      )}

      {toBuy.length >= 2 && <RecipeIdeas items={toBuy} onOpenSettings={onOpenSettings} />}

      {note && (
        <div className="section">
          <h2 className="section__title">Faire les courses</h2>
          <div className="group">
            <Row icon={<CalendarDays size={18} />} label="Quand" onClear={note.date ? () => edit(() => ({ date: undefined, time: undefined, reminder: undefined })) : undefined}>
              <Picker
                type="date"
                value={note.date ?? ''}
                display={note.date ? relativeDay(fromKey(note.date)) : 'Ajouter'}
                onChange={(v) => edit(() => (v ? { date: v, doneDates: [] } : { date: undefined, time: undefined, reminder: undefined }))}
              />
            </Row>
            {note.date && (
              <>
                <Row icon={<Clock size={18} />} label="Heure" onClear={note.time ? () => edit(() => ({ time: undefined })) : undefined}>
                  <Picker
                    type="time"
                    value={note.time ?? ''}
                    display={note.time ?? 'Toute la journée'}
                    onChange={(v) => edit(() => ({ time: v || undefined }))}
                  />
                </Row>
                <Row icon={<Bell size={18} />} label="Rappel">
                  <SelectPicker
                    value={note.reminder === undefined ? '' : String(note.reminder)}
                    display={note.reminder === undefined ? 'Aucun' : describeReminder(note.reminder, !!note.time)}
                    onChange={(v) => edit(() => ({ reminder: v === '' ? undefined : Number(v) }))}
                    options={[['', 'Aucun'], ...reminderOptions.map((m) => [String(m), describeReminder(m, !!note.time)] as [string, string])]}
                  />
                </Row>
              </>
            )}
          </div>
          <p className="footnote">
            {note.date ? 'La tâche apparaît dans Aujourd’hui et l’agenda.' : 'Ajoutez une date pour retrouver les courses dans l’agenda.'}
            {space && note.shared && (
              <>
                {' '}
                <Users size={12} className="inline-icon" /> Liste partagée avec « {space.name} ».
              </>
            )}
          </p>
        </div>
      )}
    </section>
  )
}

interface ItemRowProps {
  item: Item
  onToggle: () => void
  onQty?: (qty: number | undefined) => void
  onRemove?: () => void
}

function ItemRow({ item, onToggle, onQty, onRemove }: ItemRowProps) {
  const qty = describeQty(item)
  // Le pas de +/- n'a de sens que pour un nombre d'articles (pas pour « 500 g »).
  const count = item.unit ? null : (item.qty ?? 1)
  return (
    <div className={`row shop-item${item.checked ? ' shop-item--on' : ''}`}>
      <label className="shop-item__main">
        <span className="round-check">
          <input type="checkbox" checked={item.checked} onChange={onToggle} />
          <span />
        </span>
        <span className="shop-item__name">{item.name}</span>
        {qty && (item.checked || count === null) && <span className="shop-item__qty">{qty}</span>}
      </label>
      {!item.checked && onQty && onRemove && (
        <div className="stepper stepper--small">
          {count !== null && count > 1 ? (
            <button onClick={() => onQty(count - 1 > 1 ? count - 1 : undefined)} aria-label="Moins"><Minus size={15} /></button>
          ) : (
            <button onClick={onRemove} aria-label={`Retirer ${item.name}`}><Trash2 size={15} /></button>
          )}
          {count !== null && <span>{count}</span>}
          {count !== null && <button onClick={() => onQty(count + 1)} aria-label="Plus"><Plus size={15} /></button>}
        </div>
      )}
    </div>
  )
}
