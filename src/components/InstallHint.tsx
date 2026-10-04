import { Share, SquarePlus, X } from 'lucide-react'
import { useState } from 'react'
import { promptInstall, useCanPromptInstall } from '../lib/install'
import { isIos, isStandalone } from '../lib/platform'

const BANNER_KEY = 'sillage:install-hint-dismissed'
const SHEET_KEY = 'sillage:install-sheet-seen'

function readFlag(key: string) {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function writeFlag(key: string) {
  try {
    localStorage.setItem(key, '1')
  } catch {
    /* stockage indisponible : l'invitation reviendra, sans gravité */
  }
}

function IosSteps() {
  return (
    <ol className="install-sheet__steps">
      <li>
        Touchez <Share size={16} className="inline-icon" /> <strong>Partager</strong> dans la barre de Safari
      </li>
      <li>
        Choisissez <SquarePlus size={16} className="inline-icon" /> <strong>Sur l’écran d’accueil</strong>
      </li>
      <li>
        Touchez <strong>Ajouter</strong>, puis ouvrez Sillage depuis l’écran d’accueil
      </li>
    </ol>
  )
}

/**
 * À la première visite dans le navigateur, propose d'installer l'app (feuille en bas de l'écran).
 * Une fois fermée, le bandeau d'InstallHint prend le relais sur l'écran Aujourd'hui.
 */
export function InstallSheet() {
  const canPrompt = useCanPromptInstall()
  // Ouverte par un lien d'invitation : l'encart d'invitation explique déjà quoi faire, on ne le cache pas.
  const [seen, setSeen] = useState(() => readFlag(SHEET_KEY) || location.hash.startsWith('#rejoindre='))

  if (seen || isStandalone() || (!isIos() && !canPrompt)) return null

  function close() {
    writeFlag(SHEET_KEY)
    setSeen(true)
  }

  async function install() {
    await promptInstall()
    close()
  }

  return (
    <div className="install-sheet" role="dialog" aria-modal="true" aria-labelledby="install-sheet-title">
      <div className="install-sheet__backdrop" onClick={close} />
      <div className="install-sheet__panel">
        <img className="install-sheet__icon" src="/pwa-192.png" alt="" width={64} height={64} />
        <h2 id="install-sheet-title" className="install-sheet__title">Installez Sillage</h2>
        <p className="install-sheet__text">
          Ajoutez l’app à l’écran d’accueil : elle s’ouvre comme une vraie app, fonctionne hors ligne
          {isIos() ? ', vos notes sont protégées de l’effacement automatique de Safari et les rappels peuvent vous être notifiés.' : ' et peut vous envoyer des rappels.'}
        </p>
        {isIos() ? <IosSteps /> : null}
        <div className="install-sheet__actions">
          {canPrompt && (
            <button className="btn btn--primary" onClick={install}>
              Installer
            </button>
          )}
          <button className={`btn${canPrompt ? '' : ' btn--primary'}`} onClick={close}>
            {isIos() ? 'J’ai compris' : 'Plus tard'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Invite à installer l'app : sur iPhone, c'est aussi ce qui protège les données de l'effacement automatique. */
export function InstallHint() {
  const [dismissed, setDismissed] = useState(() => readFlag(BANNER_KEY))
  const canPrompt = useCanPromptInstall()

  if (dismissed || isStandalone() || (!isIos() && !canPrompt)) return null

  function dismiss() {
    setDismissed(true)
    writeFlag(BANNER_KEY)
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
      {canPrompt && (
        <button className="btn btn--primary" onClick={() => void promptInstall()}>
          Installer
        </button>
      )}
      <button className="icon-btn" onClick={dismiss} aria-label="Masquer">
        <X size={18} />
      </button>
    </div>
  )
}
