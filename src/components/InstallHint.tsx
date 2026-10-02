import { Share, SquarePlus, X } from 'lucide-react'
import { useEffect, useState } from 'react'

const KEY = 'sillage:install-hint-dismissed'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
}

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent)

function readDismissed() {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

/** Invite à installer l'app : sur iPhone, c'est aussi ce qui protège les données de l'effacement automatique. */
export function InstallHint() {
  const [dismissed, setDismissed] = useState(readDismissed)
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setPrompt(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  if (dismissed || isStandalone() || (!isIos() && !prompt)) return null

  function dismiss() {
    setDismissed(true)
    try {
      localStorage.setItem(KEY, '1')
    } catch {
      /* stockage indisponible : le bandeau reviendra, sans gravité */
    }
  }

  return (
    <div className="install">
      <div className="install__text">
        <strong>Installer Sillage</strong>
        {isIos() ? (
          <span>
            Touchez <Share size={15} className="inline-icon" /> Partager, puis <SquarePlus size={15} className="inline-icon" /> « Sur l’écran
            d’accueil ». Vos notes y seront mieux protégées.
          </span>
        ) : (
          <span>Ajoutez l’app à l’écran d’accueil pour l’ouvrir comme une vraie app.</span>
        )}
      </div>
      {prompt && (
        <button className="btn btn--primary" onClick={() => prompt.prompt().then(() => setPrompt(null))}>
          Installer
        </button>
      )}
      <button className="icon-btn" onClick={dismiss} aria-label="Masquer">
        <X size={18} />
      </button>
    </div>
  )
}
