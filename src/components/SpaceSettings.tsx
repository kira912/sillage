import { useLiveQuery } from 'dexie-react-hooks'
import { Copy, LogOut, RefreshCw, Share2, UserPlus, Users, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { db } from '../lib/db'
import { fmt } from '../lib/dates'
import {
  createSpace,
  inviteCode,
  inviteLink,
  joinSpace,
  leaveSpace,
  syncSpace,
  updateSpaceMeta,
  useSpace,
  type SpaceState,
} from '../lib/space'
import { useToast } from './Toast'

/** Code reçu via un lien `#rejoindre=…` (ouvert dans le navigateur). */
function inviteFromHash(): string {
  return location.hash.startsWith('#rejoindre=') ? location.hash.slice(1) : ''
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

function SpaceSetup() {
  const [mode, setMode] = useState<'none' | 'create' | 'join'>(() => (inviteFromHash() ? 'join' : 'none'))
  const [spaceName, setSpaceName] = useState('Famille')
  const [name, setName] = useState('')
  const [invite, setInvite] = useState(inviteFromHash)
  const [busy, setBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const toast = useToast()

  async function submit() {
    setBusy(true)
    setErrorMsg('')
    try {
      if (mode === 'create') await createSpace(spaceName.trim() || 'Famille', name.trim())
      else await joinSpace(invite, name.trim())
      if (inviteFromHash()) history.replaceState(null, '', location.pathname)
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
  const notes = useLiveQuery(() => db.notes.filter((n) => !n.deletedAt).toArray(), [])

  // Notes existantes portant une étiquette partagée mais pas encore partagées.
  const unshared = (notes ?? []).filter((n) => !n.shared && n.tags.some((t) => space.tags.includes(t)))
  const sharedCount = (notes ?? []).filter((n) => n.shared).length

  useEffect(() => {
    void syncSpace()
  }, [])

  async function invite() {
    const text = `Rejoins mon espace Sillage « ${space.name} » : dans l’app, Réglages → Partage → Rejoindre un espace, puis colle ce code :\n${inviteCode(space)}`
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
    if (!confirm(`Quitter l’espace « ${space.name} » ? Les notes partagées resteront sur ce téléphone, en notes personnelles.`)) return
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
        <button className="btn btn--small" disabled={syncing} onClick={syncNow}>Synchroniser</button>
      </div>

      <button className="group__action group__action--danger" onClick={leave}>
        <LogOut size={18} /> Quitter l’espace
      </button>
    </div>
  )
}
