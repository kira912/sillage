import { useLiveQuery } from 'dexie-react-hooks'
import { ClipboardPaste, Copy, LogOut, RefreshCw, Share2, UserPlus, Users, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { db } from '../lib/db'
import { fmt } from '../lib/dates'
import {
  createSpace,
  inviteCode,
  inviteLink,
  joinSpace,
  leaveSpace,
  parseInvite,
  syncSpace,
  updateSpaceMeta,
  useSpace,
  type SpaceState,
} from '../lib/space'
import { isIos, isStandalone } from '../lib/platform'
import { useConfirm } from './Sheet'
import { useToast } from './Toast'

/** Code reçu via un lien `#rejoindre=…` (ouvert dans le navigateur). */
function inviteFromHash(): string {
  return location.hash.startsWith('#rejoindre=') ? location.hash.slice(1) : ''
}

/** Lit une invitation dans le presse-papiers (iOS affiche sa bulle « Coller » : appeler depuis un geste). */
async function inviteFromClipboard(): Promise<string | null> {
  try {
    return parseInvite(await navigator.clipboard.readText())
  } catch {
    return null
  }
}

const PASTE_BANNER_KEY = 'sillage:paste-invite-dismissed'

/**
 * Sur iPhone, un lien d'invitation s'ouvre toujours dans Safari, jamais dans l'app installée (dont les données
 * sont séparées). L'encart de Safari fait copier l'invitation ; ce bandeau, dans l'app, la récupère.
 */
export function PasteInviteBanner({ onFound }: { onFound: () => void }) {
  const space = useSpace()
  const toast = useToast()
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(PASTE_BANNER_KEY) === '1'
    } catch {
      return false
    }
  })

  if (space || dismissed || !isStandalone()) return null

  function dismiss() {
    setDismissed(true)
    try {
      localStorage.setItem(PASTE_BANNER_KEY, '1')
    } catch {
      /* le bandeau reviendra, sans gravité */
    }
  }

  async function paste() {
    const secret = await inviteFromClipboard()
    if (!secret) {
      toast('Aucune invitation copiée : copiez d’abord le lien reçu')
      return
    }
    history.replaceState(null, '', `#rejoindre=${encodeURIComponent(secret)}`)
    onFound()
  }

  return (
    <div className="install">
      <div className="install__text">
        <strong>Invitation reçue ?</strong>
        <span>Copiez le lien reçu, puis touchez Coller pour rejoindre l’espace partagé.</span>
      </div>
      <button className="btn btn--primary" onClick={paste}>
        <ClipboardPaste size={16} /> Coller
      </button>
      <button className="icon-btn" onClick={dismiss} aria-label="Masquer">
        <X size={18} />
      </button>
    </div>
  )
}

export function SpaceSettings() {
  const space = useSpace()
  return (
    <>
      <h2 className="section__title">Partage</h2>
      {space ? <SpaceDetails space={space} /> : <SpaceSetup />}
      <p className="footnote">
        Les notes partagées sont chiffrées sur le téléphone avant d’être envoyées : le serveur ne peut pas les lire.
        Seuls les téléphones qui ont le code d’invitation y ont accès.
      </p>
    </>
  )
}

/**
 * Encart affiché en haut des réglages quand l'app est ouverte par un lien d'invitation (#rejoindre=…) :
 * sans lui, le formulaire serait caché plus bas, sous « Mes données ».
 */
export function InviteCard() {
  const space = useSpace()
  const [invite, setInvite] = useState(inviteFromHash)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [joinInBrowser, setJoinInBrowser] = useState(false)
  const toast = useToast()
  // Sur iPhone, le lien s'ouvre dans Safari, dont les données sont séparées de celles de l'app installée.
  const inBrowserOnIos = isIos() && !isStandalone()

  if (!invite) return null

  function close() {
    history.replaceState(null, '', location.pathname)
    setInvite('')
  }

  async function join() {
    setBusy(true)
    setErrorMsg('')
    try {
      await joinSpace(invite, name.trim())
      close()
      toast('Espace rejoint')
    } catch (e) {
      setErrorMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(`${location.origin}/#${invite}`)
      toast('Invitation copiée')
    } catch {
      toast('Copie impossible')
    }
  }

  const joinForm = (
    <>
      <label className="form__field">
        Votre prénom
        <input className="field" value={name} placeholder="Visible par les autres membres" onChange={(e) => setName(e.target.value)} />
      </label>
      {errorMsg && <p className="capture__error">{errorMsg}</p>}
      <button className="btn btn--primary invite-card__submit" disabled={!name.trim() || busy} onClick={join}>
        {busy && <span className="spinner" />}
        Rejoindre l’espace{inBrowserOnIos ? ' dans Safari' : ''}
      </button>
    </>
  )

  return (
    <div className="invite-card">
      <button className="invite-card__close" aria-label="Fermer" onClick={close}><X size={18} /></button>
      <span className="invite-card__icon"><UserPlus size={22} /></span>
      <p className="invite-card__title">Invitation à un espace partagé</p>
      {space ? (
        <p className="invite-card__text">
          Ce téléphone est déjà dans l’espace « {space.name} ». Quittez-le (plus bas, section Partage) pour en rejoindre
          un autre.
        </p>
      ) : inBrowserOnIos ? (
        <>
          <p className="invite-card__text">
            Sur iPhone, les liens s’ouvrent dans Safari et non dans l’app installée. Pour rejoindre l’espace dans l’app :
          </p>
          <ol className="invite-card__steps">
            <li>
              <button className="btn btn--primary btn--small" onClick={copyInvite}><Copy size={14} /> Copier l’invitation</button>
            </li>
            <li>Ouvrez Sillage depuis l’écran d’accueil</li>
            <li>Touchez <strong>Coller</strong> dans le bandeau « Invitation reçue ? »</li>
          </ol>
          <p className="invite-card__hint">
            L’app n’est pas encore installée ? Touchez Partager puis « Sur l’écran d’accueil », ouvrez-la, et suivez
            les étapes ci-dessus.
          </p>
          {joinInBrowser ? (
            joinForm
          ) : (
            <button className="btn btn--small" onClick={() => setJoinInBrowser(true)}>Rejoindre plutôt dans Safari</button>
          )}
        </>
      ) : (
        <>
          <p className="invite-card__text">
            Les notes partagées de l’espace apparaîtront dans vos notes, chiffrées : seuls ses membres peuvent les lire.
          </p>
          {joinForm}
        </>
      )}
    </div>
  )
}

function SpaceSetup() {
  const [mode, setMode] = useState<'none' | 'create' | 'join'>('none')
  const [spaceName, setSpaceName] = useState('Famille')
  const [name, setName] = useState('')
  const [invite, setInvite] = useState('')
  const [busy, setBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const toast = useToast()

  async function submit() {
    setBusy(true)
    setErrorMsg('')
    try {
      if (mode === 'create') await createSpace(spaceName.trim() || 'Famille', name.trim())
      else await joinSpace(invite, name.trim())
      toast(mode === 'create' ? 'Espace créé' : 'Espace rejoint')
    } catch (e) {
      setErrorMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (mode === 'none') {
    return (
      <div className="group">
        <button className="group__action" onClick={() => setMode('create')}>
          <Users size={18} /> Créer un espace partagé
        </button>
        <button className="group__action" onClick={() => setMode('join')}>
          <UserPlus size={18} /> Rejoindre un espace
        </button>
      </div>
    )
  }

  const valid = name.trim() && (mode === 'create' || invite.trim())
  return (
    <div className="group">
      <div className="row-block form">
        <p className="form__title">{mode === 'create' ? 'Nouvel espace partagé' : 'Rejoindre un espace'}</p>
        {mode === 'create' ? (
          <label className="form__field">
            Nom de l’espace
            <input className="field" value={spaceName} onChange={(e) => setSpaceName(e.target.value)} />
          </label>
        ) : (
          <label className="form__field">
            Code ou lien d’invitation
            <input
              className="field"
              value={invite}
              autoCapitalize="none"
              autoComplete="off"
              placeholder="Collez le code reçu"
              onChange={(e) => setInvite(e.target.value)}
            />
            <button
              type="button"
              className="btn btn--small form__inline-action"
              onClick={async () => {
                const secret = await inviteFromClipboard()
                if (secret) setInvite(secret)
                else toast('Aucune invitation dans le presse-papiers')
              }}
            >
              <ClipboardPaste size={14} /> Coller
            </button>
          </label>
        )}
        <label className="form__field">
          Votre prénom
          <input className="field" value={name} placeholder="Visible par les autres membres" onChange={(e) => setName(e.target.value)} />
        </label>
        {errorMsg && <p className="capture__error">{errorMsg}</p>}
        <div className="btn-row">
          <button className="btn" onClick={() => setMode('none')}>Annuler</button>
          <button className="btn btn--primary" disabled={!valid || busy} onClick={submit}>
            {busy && <span className="spinner" />}
            {mode === 'create' ? 'Créer' : 'Rejoindre'}
          </button>
        </div>
      </div>
    </div>
  )
}

function SpaceDetails({ space }: { space: SpaceState }) {
  const [tagInput, setTagInput] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [showCode, setShowCode] = useState(false)
  const toast = useToast()
  const confirm = useConfirm()
  const notes = useLiveQuery(() => db.notes.filter((n) => !n.deletedAt).toArray(), [])

  // Notes existantes portant une étiquette partagée mais pas encore partagées.
  const unshared = (notes ?? []).filter((n) => !n.shared && n.tags.some((t) => space.tags.includes(t)))
  const sharedCount = (notes ?? []).filter((n) => n.shared).length

  useEffect(() => {
    void syncSpace()
  }, [])

  async function invite() {
    const text = `Rejoins mon espace Sillage « ${space.name} » : ouvre ce lien. Si tu as l’app sur l’écran d’accueil, copie plutôt le lien, ouvre l’app et touche « Coller ».`
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Invitation Sillage', text, url: inviteLink(space) })
        return
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
      }
    }
    setShowCode(true)
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(inviteCode(space))
      toast('Code copié')
    } catch {
      toast('Copie impossible : sélectionnez le code')
    }
  }

  function addTag() {
    const t = tagInput.replace(/^#/, '').trim().toLowerCase()
    setTagInput('')
    if (t && !space.tags.includes(t)) updateSpaceMeta({ tags: [...space.tags, t] })
  }

  async function shareExisting() {
    await db.notes.bulkUpdate(unshared.map((n) => ({ key: n.id, changes: { shared: true } })))
    toast(`${unshared.length} note(s) partagée(s)`)
  }

  async function syncNow() {
    setSyncing(true)
    await syncSpace()
    setSyncing(false)
  }

  async function leave() {
    const ok = await confirm({
      title: `Quitter « ${space.name} » ?`,
      message: 'Les notes partagées resteront sur ce téléphone, en notes personnelles. Les autres membres les gardent aussi.',
      confirmLabel: 'Quitter l’espace',
      danger: true,
    })
    if (!ok) return
    await leaveSpace()
    toast('Espace quitté')
  }

  return (
    <div className="group">
      <div className="row">
        <span className="row__icon"><Users size={18} /></span>
        <span className="row__label row__label--grow">
          <strong>{space.name}</strong>
          <small className="muted"> · {sharedCount} note(s) partagée(s)</small>
        </span>
      </div>
      <div className="row-block">
        <div className="chips">
          {space.members.map((m) => (
            <span key={m.id} className="chip chip--static">
              {m.name}
              {m.id === space.memberId ? ' (vous)' : ''}
            </span>
          ))}
        </div>
      </div>

      <button className="group__action" onClick={invite}>
        <Share2 size={18} /> Inviter quelqu’un
      </button>
      {showCode && (
        <div className="row-block invite">
          <p className="footnote">Envoyez ce code à la personne à inviter. Il donne accès aux notes partagées : ne le partagez qu’avec elle.</p>
          <code className="invite__code">{inviteCode(space)}</code>
          <button className="btn btn--small" onClick={copyCode}><Copy size={14} /> Copier</button>
        </div>
      )}

      <div className="row-block">
        <p className="form__label">Étiquettes partagées automatiquement</p>
        <div className="tags-input">
          {space.tags.map((t) => (
            <button
              key={t}
              className="chip chip--on chip--removable"
              onClick={() => updateSpaceMeta({ tags: space.tags.filter((x) => x !== t) })}
              aria-label={`Retirer #${t}`}
            >
              #{t} <X size={12} />
            </button>
          ))}
          <input
            placeholder="Ajouter…"
            value={tagInput}
            autoCapitalize="none"
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ',') && (e.preventDefault(), addTag())}
            onBlur={() => tagInput && addTag()}
          />
        </div>
        {unshared.length > 0 && (
          <button className="btn btn--small form__inline-action" onClick={shareExisting}>
            Partager aussi les {unshared.length} note(s) existante(s) avec ces étiquettes
          </button>
        )}
      </div>

      <div className="row">
        <span className="row__icon"><RefreshCw size={18} className={syncing ? 'spin' : ''} /></span>
        <span className="row__label row__label--grow">
          {space.lastError ? (
            <span className="warn">{space.lastError}</span>
          ) : space.lastSync ? (
            `Synchronisé à ${fmt(new Date(space.lastSync), 'HH:mm')}`
          ) : (
            'Pas encore synchronisé'
          )}
        </span>
        {space.lastError && <button className="btn btn--small" disabled={syncing} onClick={syncNow}>Réessayer</button>}
      </div>

      <button className="group__action group__action--danger" onClick={leave}>
        <LogOut size={18} /> Quitter l’espace
      </button>
    </div>
  )
}
