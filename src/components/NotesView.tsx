import { useLiveQuery } from 'dexie-react-hooks'
import { Search, Users, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { activeNotes } from '../lib/db'
import { plainText } from '../lib/richtext'
import { isShoppingList } from '../lib/shopping'
import { useSpace } from '../lib/space'
import { NoteCard } from './NoteCard'
import { Section } from './Section'

export function NotesView({ onOpen }: { onOpen: (id: string) => void }) {
  // La liste de courses a son propre onglet ; les notes datées sont dans l'agenda, mais la recherche les retrouve.
  const all = useLiveQuery(async () => (await activeNotes()).filter((n) => !isShoppingList(n)), [])
  const notes = useMemo(() => all?.filter((n) => !n.date), [all])
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [sharedOnly, setSharedOnly] = useState(false)
  const space = useSpace()

  const allTags = useMemo(() => {
    const count = new Map<string, number>()
    notes?.forEach((n) => n.tags.forEach((t) => count.set(t, (count.get(t) ?? 0) + 1)))
    // Les étiquettes les plus utilisées en premier.
    return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr')).map(([t]) => t)
  }, [notes])

  const q = normalize(query.trim())
  const matches = useMemo(
    () =>
      (all ?? [])
        .filter((n) => !tag || n.tags.includes(tag))
        .filter((n) => !sharedOnly || (space && n.shared))
        .filter((n) => !q || normalize(`${plainText(n.title)}\n${plainText(n.body)}\n${n.tags.join(' ')}\n${n.location ?? ''}`).includes(q)),
    [all, q, tag, sharedOnly, space],
  )

  if (!all || !notes) return null

  const filtered = matches.filter((n) => !n.date)
  const inAgenda = q ? matches.filter((n) => n.date) : []

  const pinned = filtered.filter((n) => n.pinned)
  const others = filtered.filter((n) => !n.pinned)

  return (
    <section className="view">
      <div className="search">
        <Search size={18} className="search__icon" />
        <input type="search" placeholder="Rechercher" value={query} onChange={(e) => setQuery(e.target.value)} />
        {query && (
          <button className="search__clear" onClick={() => setQuery('')} aria-label="Effacer">
            <X size={16} />
          </button>
        )}
      </div>

      {(allTags.length > 0 || space) && (
        <div className="chips chips--scroll">
          <button
            className={`chip${tag === null && !sharedOnly ? ' chip--on' : ''}`}
            aria-pressed={tag === null && !sharedOnly}
            onClick={() => (setTag(null), setSharedOnly(false))}
          >
            Toutes
          </button>
          {space && (
            <button className={`chip${sharedOnly ? ' chip--on' : ''}`} aria-pressed={sharedOnly} onClick={() => setSharedOnly(!sharedOnly)}>
              <Users size={14} /> Partagées
            </button>
          )}
          {allTags.map((t) => (
            <button key={t} className={`chip${tag === t ? ' chip--on' : ''}`} aria-pressed={tag === t} onClick={() => setTag(tag === t ? null : t)}>
              #{t}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 && inAgenda.length === 0 ? (
        <p className="empty">
          {notes.length === 0 ? 'Aucune note pour l’instant. Touchez + pour en écrire une.' : 'Aucune note ne correspond.'}
        </p>
      ) : filtered.length === 0 ? null : pinned.length > 0 ? (
        <>
          <Section title="Épinglées">
            {pinned.map((n) => <NoteCard key={n.id} note={n} onOpen={onOpen} />)}
          </Section>
          {others.length > 0 && (
            <Section title="Autres">
              {others.map((n) => <NoteCard key={n.id} note={n} onOpen={onOpen} />)}
            </Section>
          )}
        </>
      ) : (
        <div className="list">
          {others.map((n) => <NoteCard key={n.id} note={n} onOpen={onOpen} />)}
        </div>
      )}

      {inAgenda.length > 0 && (
        <Section title="Dans l’agenda">
          {inAgenda.map((n) => <NoteCard key={n.id} note={n} onOpen={onOpen} />)}
        </Section>
      )}
    </section>
  )
}

/** Recherche insensible à la casse et aux accents. */
function normalize(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
}
