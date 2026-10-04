import { useSyncExternalStore } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/**
 * Proposition d'installation de Chrome / Android (`beforeinstallprompt`). L'événement n'est envoyé qu'une fois,
 * tôt au chargement : il est capturé ici, dès l'import du module, pour que l'interface puisse s'en servir plus tard.
 * (Safari n'en a pas : sur iPhone, l'installation se fait à la main depuis le bouton Partager.)
 */
let deferred: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  deferred = e as BeforeInstallPromptEvent
  notify()
})
window.addEventListener('appinstalled', () => {
  deferred = null
  notify()
})

/** `true` quand le navigateur peut afficher sa propre fenêtre d'installation. */
export function useCanPromptInstall(): boolean {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => deferred !== null,
  )
}

/** Ouvre la fenêtre d'installation du navigateur ; renvoie `true` si l'app a été installée. */
export async function promptInstall(): Promise<boolean> {
  const event = deferred
  if (!event) return false
  deferred = null // utilisable une seule fois
  notify()
  await event.prompt()
  return (await event.userChoice).outcome === 'accepted'
}
