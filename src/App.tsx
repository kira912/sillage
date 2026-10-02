import { CalendarDays, NotebookPen, Plus, Settings, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { AgendaView } from './components/AgendaView'
import { InstallHint } from './components/InstallHint'
import { NoteEditor } from './components/NoteEditor'
import { NotesView } from './components/NotesView'
import { SettingsView } from './components/SettingsView'
import { TodayView } from './components/TodayView'
import { purgeOldTrash } from './lib/db'
import { toKey } from './lib/dates'
import type { Note } from './lib/types'

type Tab = 'today' | 'notes' | 'agenda' | 'settings'
type EditorState = { id: string | null; defaults?: Partial<Note> } | null

const TABS = [
  { id: 'today', label: 'Aujourd’hui', icon: Sun },
  { id: 'notes', label: 'Notes', icon: NotebookPen },
  { id: 'agenda', label: 'Agenda', icon: CalendarDays },
  { id: 'settings', label: 'Réglages', icon: Settings },
] as const

const TITLES: Record<Tab, string> = { today: 'Aujourd’hui', notes: 'Notes', agenda: 'Agenda', settings: 'Réglages' }

export default function App() {
  const [tab, setTab] = useState<Tab>('today')
  const [editor, setEditor] = useState<EditorState>(null)
  const [selectedDay, setSelectedDay] = useState(() => new Date())

  useEffect(() => {
    purgeOldTrash()
    // Demande silencieuse : accordée d'office aux apps installées sur l'écran d'accueil.
    navigator.storage?.persist?.()
  }, [])

  // L'éditeur ajoute une entrée d'historique : le geste « retour » du téléphone le ferme.
  useEffect(() => {
    const onPop = () => setEditor(null)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  function openEditor(state: NonNullable<EditorState>) {
    setEditor(state)
    history.pushState({ editor: true }, '')
  }

  const open = (id: string) => openEditor({ id })
  const create = () => openEditor({ id: null, defaults: tab === 'agenda' ? { date: toKey(selectedDay) } : {} })

  function switchTab(next: Tab) {
    setTab(next)
    window.scrollTo({ top: 0 })
  }

  if (editor) {
    return (
      <div className="app">
        <NoteEditor
          key={editor.id ?? 'new'}
          id={editor.id}
          defaults={editor.defaults}
          onClose={() => history.back()}
          onReplace={(id) => setEditor({ id })}
        />
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>{TITLES[tab]}</h1>
      </header>
      {tab === 'today' && <InstallHint />}
      <main>
        {tab === 'today' && <TodayView onOpen={open} onCreate={create} />}
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
    </div>
  )
}
