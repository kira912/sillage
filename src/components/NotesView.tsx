import { useLiveQuery } from 'dexie-react-hooks'
import { Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { activeNotes } from '../lib/db'
import { NoteCard } from './NoteCard'
import { Section } from './Section'

export function NotesView({ onOpen }: { onOpen: (id: string) => void }) {
  const notes = useLiveQuery(activeNotes, [])
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState<string | null>(null)

  const allTags = useMemo(() => {
    const count = new Map<string, number>()
    notes?.forEach((n) => n.tags.forEach((t) => count.set(t, (count.get(t) ?? 0) + 1)))
    // Les étiquettes les plus utilisées en premier.
    return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr')).map(([t]) => t)
  }, [notes])

  const filtered = useMemo(() => {
    const q = normalize(query.trim())
    return (notes ?? [])
      .filter((n) => !tag || n.tags.includes(tag))
      .filter((n) => !q || normalize(`${n.title}\n${n.body}\n${n.tags.join(' ')}\n${n.location ?? ''}`).includes(q))
  }, [notes, query, tag])

  if (!notes) return null

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

      {allTags.length > 0 && (
        <div className="chips chips--scroll">
          <button className={`chip${tag === null ? ' chip--on' : ''}`} onClick={() => setTag(null)}>
            Toutes
          </button>
          {allTags.map((t) => (
            <button key={t} className={`chip${tag === t ? ' chip--on' : ''}`} onClick={() => setTag(tag === t ? null : t)}>
              #{t}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="empty">
          {notes.length === 0 ? 'Aucune note pour l’instant. Touchez + pour commencer.' : 'Aucun résultat.'}
        </p>
      ) : pinned.length > 0 ? (
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
    </section>
  )
}

/** Recherche insensible à la casse et aux accents. */
function normalize(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
}
