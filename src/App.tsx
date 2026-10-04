import { useLiveQuery } from 'dexie-react-hooks'
import { CalendarDays, NotebookPen, Plus, Settings, Sparkles, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { AgendaView } from './components/AgendaView'
import { InstallHint, InstallSheet } from './components/InstallHint'
import { NoteEditor } from './components/NoteEditor'
import { NotesView } from './components/NotesView'
import { QuickCapture } from './components/QuickCapture'
import { SettingsView } from './components/SettingsView'
import { TodayView } from './components/TodayView'
import { activeNotes, db, purgeOldTrash } from './lib/db'
import { toKey } from './lib/dates'
import { isPushEnabled, syncReminders } from './lib/push'
import { getSpace, syncSpace } from './lib/space'
import type { Note } from './lib/types'

type Tab = 'today' | 'notes' | 'agenda' | 'settings'
type EditorState = { id: string | null; defaults?: Partial<Note> } | null
type Overlay = { kind: 'editor'; state: NonNullable<EditorState> } | { kind: 'capture' } | null

const TABS = [
  { id: 'today', label: 'Aujourd’hui', icon: Sun },
  { id: 'notes', label: 'Notes', icon: NotebookPen },
  { id: 'agenda', label: 'Agenda', icon: CalendarDays },
  { id: 'settings', label: 'Réglages', icon: Settings },
] as const

const TITLES: Record<Tab, string> = { today: 'Aujourd’hui', notes: 'Notes', agenda: 'Agenda', settings: 'Réglages' }

export default function App() {
  // Un lien d'invitation (#rejoindre=…) ouvre directement les réglages de partage.
  const [tab, setTab] = useState<Tab>(() => (location.hash.startsWith('#rejoindre=') ? 'settings' : 'today'))
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [selectedDay, setSelectedDay] = useState(() => new Date())
  useReminderSync()
  useSpaceSync()

  useEffect(() => {
    purgeOldTrash()
    // Demande silencieuse : accordée d'office aux apps installées sur l'écran d'accueil.
    navigator.storage?.persist?.()
  }, [])

  // Éditeur et saisie rapide ajoutent une entrée d'historique : le geste « retour » du téléphone les ferme.
  useEffect(() => {
    const onPop = () => setOverlay(null)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  function openOverlay(next: NonNullable<Overlay>) {
    setOverlay(next)
    history.pushState({ overlay: next.kind }, '')
  }

  const open = (id: string) => openOverlay({ kind: 'editor', state: { id } })
  const create = () =>
    openOverlay({ kind: 'editor', state: { id: null, defaults: tab === 'agenda' ? { date: toKey(selectedDay) } : {} } })
  const capture = () => openOverlay({ kind: 'capture' })

  function switchTab(next: Tab) {
    setTab(next)
    window.scrollTo({ top: 0 })
  }

  if (overlay?.kind === 'editor') {
    const editor = overlay.state
    return (
      <div className="app">
        <NoteEditor
          key={editor.id ?? 'new'}
          id={editor.id}
          defaults={editor.defaults}
          onClose={() => history.back()}
          onReplace={(id) => setOverlay({ kind: 'editor', state: { id } })}
        />
      </div>
    )
  }

  if (overlay?.kind === 'capture') {
    return (
      <div className="app">
        <QuickCapture
          onClose={() => history.back()}
          onOpenSettings={() => {
            history.back()
            switchTab('settings')
          }}
        />
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>{TITLES[tab]}</h1>
        {tab !== 'settings' && (
          <button className="icon-btn topbar__action" onClick={capture} aria-label="Saisie rapide">
            <Sparkles size={22} />
          </button>
        )}
      </header>
      {tab === 'today' && <InstallHint />}
      <main>
        {tab === 'today' && <TodayView onOpen={open} onCreate={create} onCapture={capture} />}
        {tab === 'notes' && <NotesView onOpen={open} />}
        {tab === 'agenda' && <AgendaView selected={selectedDay} onSelect={setSelectedDay} onOpen={open} />}
        {tab === 'settings' && <SettingsView />}
      </main>
      {tab !== 'settings' && (
        <button className="fab" onClick={create} aria-label="Nouvelle note">
          <Plus size={28} strokeWidth={2.5} />
        </button>
      )}
      <nav className="tabbar">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`tabbar__item${tab === id ? ' tabbar__item--on' : ''}`}
            onClick={() => switchTab(id)}
            aria-current={tab === id ? 'page' : undefined}
          >
            <Icon size={22} strokeWidth={tab === id ? 2.4 : 1.8} />
            {label}
          </button>
        ))}
      </nav>
      <InstallSheet />
    </div>
  )
}

/**
 * Tient à jour les rappels planifiés côté serveur : après chaque modification de notes,
 * et au retour dans l'app (la fenêtre de planification avance avec le temps).
 */
function useReminderSync() {
  const notes = useLiveQuery(activeNotes, [])

  useEffect(() => {
    if (!notes || !isPushEnabled()) return
    const t = setTimeout(() => syncReminders().catch(() => {}), 1500)
    return () => clearTimeout(t)
  }, [notes])

  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && isPushEnabled() && syncReminders().catch(() => {})
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])
}

const SPACE_POLL_MS = 20_000

/**
 * Synchronise l'espace partagé : peu après chaque modification locale, toutes les 20 s quand l'app est
 * au premier plan (pour voir les changements de l'autre personne), au retour dans l'app et au retour du réseau.
 */
function useSpaceSync() {
  const notes = useLiveQuery(() => db.notes.toArray(), [])

  useEffect(() => {
    if (!notes || !getSpace()) return
    const t = setTimeout(() => void syncSpace(), 800)
    return () => clearTimeout(t)
  }, [notes])

  useEffect(() => {
    const sync = () => document.visibilityState === 'visible' && getSpace() && void syncSpace()
    const interval = setInterval(sync, SPACE_POLL_MS)
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('online', sync)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('online', sync)
    }
  }, [])
}

