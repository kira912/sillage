import { useLiveQuery } from 'dexie-react-hooks'
import { CalendarDays, NotebookPen, Plus, Settings, ShoppingCart, Sun } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AgendaView, type AgendaMode } from './components/AgendaView'
import { InstallHint, InstallSheet } from './components/InstallHint'
import { NoteEditor } from './components/NoteEditor'
import { NotesView } from './components/NotesView'
import { QuickCapture } from './components/QuickCapture'
import { SettingsView } from './components/SettingsView'
import { ShoppingView } from './components/ShoppingView'
import { PasteInviteBanner } from './components/SpaceSettings'
import { TodayView } from './components/TodayView'
import { onNotesChanged, purgeOldTrash } from './lib/db'
import { fmt, toKey } from './lib/dates'
import { isPushEnabled, syncReminders } from './lib/push'
import { SHOPPING_ID } from './lib/shopping'
import { getSpace, pollDelay, syncSpace } from './lib/space'
import { setAppBadge } from './lib/space-push'
import { useToday } from './lib/today'
import type { Note } from './lib/types'
import { markRead, unreadNotes, unreadTab } from './lib/unread'

type Tab = 'today' | 'notes' | 'agenda' | 'shopping' | 'settings'
type EditorState = { id: string | null; defaults?: Partial<Note> } | null
type Overlay = { kind: 'editor'; state: NonNullable<EditorState> } | { kind: 'capture'; text: string } | null

const TABS = [
  { id: 'today', label: 'Aujourd’hui', icon: Sun },
  { id: 'notes', label: 'Notes', icon: NotebookPen },
  { id: 'agenda', label: 'Agenda', icon: CalendarDays },
  { id: 'shopping', label: 'Courses', icon: ShoppingCart },
  { id: 'settings', label: 'Réglages', icon: Settings },
] as const

const TITLES: Record<Exclude<Tab, 'today'>, string> = { notes: 'Notes', agenda: 'Agenda', shopping: 'Courses', settings: 'Réglages' }

/** Onglets sans bouton « nouvelle note ». */
const NO_CREATE: Tab[] = ['shopping', 'settings']

export default function App() {
  // Un lien d'invitation (#rejoindre=…) ouvre directement les réglages de partage.
  const [tab, setTab] = useState<Tab>(initialTab)
  const tabRef = useRef(tab)
  useEffect(() => {
    tabRef.current = tab
  }, [tab])
  const unread = useLiveQuery(unreadNotes, []) ?? []
  const unreadCount = (t: Tab) => (t === 'notes' || t === 'agenda' ? unread.filter((n) => unreadTab(n) === t).length : 0)
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [selectedDay, setSelectedDay] = useState(() => new Date())
  const today = useToday()
  const [agendaMode, setAgendaMode] = useState<AgendaMode>('calendar')
  useReminderSync()
  useSpaceSync()

  useEffect(() => {
    purgeOldTrash()
    // Demande silencieuse : accordée d'office aux apps installées sur l'écran d'accueil.
    navigator.storage?.persist?.()
  }, [])

  // Pastille de l'icône de l'app : le nombre de nouveautés de l'espace partagé.
  useEffect(() => {
    void setAppBadge(unread.length)
  }, [unread.length])

  // Toucher une notification « nouvelle note » ouvre l'onglet concerné ; quitter l'app vaut lecture de l'onglet affiché.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type !== 'sillage:open-tab' || (e.data.tab !== 'notes' && e.data.tab !== 'agenda')) return
      switchTab(e.data.tab)
      if (getSpace()) void syncSpace()
    }
    const onHidden = () => document.visibilityState === 'hidden' && markSeen(tabRef.current)
    navigator.serviceWorker?.addEventListener('message', onMessage)
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      navigator.serviceWorker?.removeEventListener('message', onMessage)
      document.removeEventListener('visibilitychange', onHidden)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Éditeur et saisie rapide ajoutent une entrée d'historique : le geste « retour » du téléphone les ferme.
  useEffect(() => {
    const onPop = () => setOverlay(null)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // Position de défilement des onglets, restaurée à la fermeture de l'éditeur.
  const tabScroll = useRef(0)
  const overlayKind = overlay?.kind
  useLayoutEffect(() => {
    window.scrollTo({ top: overlayKind ? 0 : tabScroll.current })
  }, [overlayKind])

  function openOverlay(next: NonNullable<Overlay>) {
    if (!overlay) tabScroll.current = window.scrollY
    setOverlay(next)
    history.pushState({ overlay: next.kind }, '')
  }

  // La liste de courses (affichée dans l'agenda quand elle a une date) s'ouvre dans son onglet.
  const open = (id: string) => (id === SHOPPING_ID ? switchTab('shopping') : openOverlay({ kind: 'editor', state: { id } }))
  const create = () =>
    openOverlay({ kind: 'editor', state: { id: null, defaults: tab === 'agenda' ? { date: toKey(selectedDay) } : {} } })

  function switchTab(next: Tab) {
    if (next !== tabRef.current) markSeen(tabRef.current)
    tabRef.current = next
    setTab(next)
    tabScroll.current = 0
    window.scrollTo({ top: 0 })
  }

  return (
    <>
      {/* Les onglets restent montés sous l'éditeur : recherche, filtres et défilement sont conservés. */}
      <div className="app" style={overlay ? { display: 'none' } : undefined}>
        <header className="topbar">
          {/* Sur Aujourd'hui, le titre est le nom du jour. */}
          <h1 className="chart-title">{tab === 'today' ? fmt(today, 'EEEE d MMMM') : TITLES[tab]}</h1>
        </header>
        {tab === 'today' && <InstallHint />}
        {tab === 'today' && <PasteInviteBanner onFound={() => switchTab('settings')} />}
        <main>
          {tab === 'today' && <TodayView onOpen={open} onCreate={create} onOpenShopping={() => switchTab('shopping')} />}
          {tab === 'notes' && <NotesView onOpen={open} />}
          {tab === 'agenda' && (
            <AgendaView mode={agendaMode} onMode={setAgendaMode} selected={selectedDay} onSelect={setSelectedDay} onOpen={open} />
          )}
          {tab === 'shopping' && <ShoppingView onOpenSettings={() => switchTab('settings')} />}
          {tab === 'settings' && <SettingsView />}
        </main>
        {!NO_CREATE.includes(tab) && (
          <button className="fab" onClick={create} aria-label="Nouvelle note">
            <Plus size={28} strokeWidth={2.5} />
          </button>
        )}
        <nav className="tabbar">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`tabbar__item${tab === id ? ' tabbar__item--on' : ''}`}
              aria-label={unreadCount(id) ? `${label}, ${unreadCount(id)} nouvelle${unreadCount(id) > 1 ? 's' : ''}` : undefined}
              onClick={() => switchTab(id)}
              aria-current={tab === id ? 'page' : undefined}
            >
              <span className="tabbar__icon">
                <Icon size={22} strokeWidth={tab === id ? 2.4 : 1.8} />
                {unreadCount(id) > 0 && <span className="tabbar__badge">{unreadCount(id)}</span>}
              </span>
              {label}
            </button>
          ))}
        </nav>
        {!overlay && <InstallSheet />}
      </div>

      {overlay?.kind === 'editor' && (
        <div className="app">
          <NoteEditor
            key={overlay.state.id ?? 'new'}
            id={overlay.state.id}
            defaults={overlay.state.defaults}
            onClose={() => history.back()}
            onReplace={(id) => setOverlay({ kind: 'editor', state: { id } })}
            onAnalyze={(text) => setOverlay({ kind: 'capture', text })}
          />
        </div>
      )}

      {overlay?.kind === 'capture' && (
        <div className="app">
          <QuickCapture
            initialText={overlay.text}
            onClose={() => history.back()}
            onOpenSettings={() => {
              history.back()
              switchTab('settings')
            }}
          />
        </div>
      )}
    </>
  )
}

/** Onglet d'ouverture : réglages pour un lien d'invitation, Notes ou Agenda depuis une notification. */
function initialTab(): Tab {
  if (location.hash.startsWith('#rejoindre=')) return 'settings'
  const fromNotification = location.hash.match(/^#onglet=(notes|agenda)$/)?.[1] as Tab | undefined
  if (fromNotification) history.replaceState(null, '', location.pathname)
  return fromNotification ?? 'today'
}

/** Les nouveautés d'un onglet sont vues quand on le quitte (ou qu'on quitte l'app depuis cet onglet). */
function markSeen(tab: Tab) {
  if (tab === 'notes' || tab === 'agenda') void markRead((n) => unreadTab(n) === tab)
}

/**
 * Tient à jour les rappels planifiés côté serveur : après chaque modification de notes,
 * et au retour dans l'app (la fenêtre de planification avance avec le temps).
 */
function useReminderSync() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const sync = () => isPushEnabled() && syncReminders().catch(() => {})
    const stop = onNotesChanged(() => {
      clearTimeout(timer)
      timer = setTimeout(sync, 1500)
    })
    const onVisible = () => document.visibilityState === 'visible' && sync()
    document.addEventListener('visibilitychange', onVisible)
    sync()
    return () => {
      stop()
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
}

/**
 * Synchronise l'espace partagé : peu après chaque modification locale (seulement s'il y a quelque chose à
 * envoyer), régulièrement quand l'app est au premier plan (toutes les 20 s si l'espace est actif, jusqu'à
 * 2 min s'il est calme), au retour dans l'app et au retour du réseau.
 */
function useSpaceSync() {
  useEffect(() => {
    let changeTimer: ReturnType<typeof setTimeout> | undefined
    let pollTimer: ReturnType<typeof setTimeout> | undefined
    const sync = () => document.visibilityState === 'visible' && getSpace() && void syncSpace()
    const poll = () => {
      sync()
      pollTimer = setTimeout(poll, pollDelay())
    }
    const stop = onNotesChanged(() => {
      clearTimeout(changeTimer)
      changeTimer = setTimeout(() => getSpace() && void syncSpace({ onlyIfChanges: true }), 800)
    })
    poll()
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('online', sync)
    return () => {
      stop()
      clearTimeout(changeTimer)
      clearTimeout(pollTimer)
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('online', sync)
    }
  }, [])
}
