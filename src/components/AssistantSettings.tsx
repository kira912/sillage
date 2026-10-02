import { Bell, BellOff, KeyRound, Send, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ApiError, fetchConfig, getAccessCode, setAccessCode, type ServerConfig } from '../lib/api'
import { disablePush, enablePush, isPushEnabled, pushSupport, syncReminders } from '../lib/push'
import { useToast } from './Toast'

type Status = { state: 'idle' } | { state: 'checking' } | { state: 'ok'; config: ServerConfig } | { state: 'error'; message: string }

export function AssistantSettings() {
  const [code, setCode] = useState(getAccessCode)
  const [status, setStatus] = useState<Status>({ state: 'idle' })
  const [pushOn, setPushOn] = useState(isPushEnabled)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const support = pushSupport()

  async function check() {
    setStatus({ state: 'checking' })
    try {
      setStatus({ state: 'ok', config: await fetchConfig() })
    } catch (e) {
      setStatus({ state: 'error', message: e instanceof ApiError && e.status === 401 ? 'Code incorrect' : (e as Error).message })
    }
  }

  useEffect(() => {
    if (getAccessCode()) check()
  }, [])

  function saveCode() {
    setAccessCode(code.trim())
    if (code.trim()) check()
    else setStatus({ state: 'idle' })
  }

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true)
    try {
      await action()
      toast(success)
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(false)
      setPushOn(isPushEnabled())
    }
  }

  const config = status.state === 'ok' ? status.config : null
  const codeSaved = code.trim() === getAccessCode() && !!code.trim()

  return (
    <>
      <h2 className="section__title">Assistant & rappels</h2>
      <div className="group">
        <div className="row">
          <span className="row__icon"><KeyRound size={18} /></span>
          <input
            className="row__input row__input--left"
            placeholder="Code d’accès"
            value={code}
            autoCapitalize="none"
            autoComplete="off"
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveCode()}
          />
          {!codeSaved && (
            <button className="btn btn--small" onClick={saveCode}>Enregistrer</button>
          )}
        </div>
        {status.state !== 'idle' && (
          <div className="row">
            <span className="row__icon"><Sparkles size={18} /></span>
            <span className="row__label row__label--grow">Saisie rapide IA</span>
            <StatusValue status={status} ok={!!config?.ai} />
          </div>
        )}
        {status.state !== 'idle' && (
          <div className="row">
            <span className="row__icon"><Bell size={18} /></span>
            <span className="row__label row__label--grow">Notifications</span>
            {support === 'needs-install' ? (
              <span className="row__value muted">Installer d’abord</span>
            ) : support === 'unsupported' ? (
              <span className="row__value muted">Non supportées ici</span>
            ) : !config?.push ? (
              <StatusValue status={status} ok={false} />
            ) : pushOn ? (
              <button className="btn btn--small" disabled={busy} onClick={() => run(disablePush, 'Notifications désactivées')}>
                <BellOff size={14} /> Désactiver
              </button>
            ) : (
              <button className="btn btn--small" disabled={busy} onClick={() => run(enablePush, 'Notification de test envoyée')}>
                Activer
              </button>
            )}
          </div>
        )}
        {pushOn && config?.push && (
          <button
            className="group__action"
            disabled={busy}
            onClick={() => run(() => syncReminders({ test: true }), 'Notification de test envoyée')}
          >
            <Send size={18} /> Envoyer une notification de test
          </button>
        )}
      </div>
      <p className="footnote">
        {support === 'needs-install'
          ? 'Sur iPhone, les notifications ne sont possibles que pour l’app installée sur l’écran d’accueil (Partager → Sur l’écran d’accueil).'
          : 'Le texte saisi est envoyé à l’IA pour être analysé. Pour les rappels, seuls le titre, la date et le lieu des notes concernées sont transmis au serveur ; le reste ne quitte pas le téléphone.'}
      </p>
    </>
  )
}

function StatusValue({ status, ok }: { status: Status; ok: boolean }) {
  if (status.state === 'checking') return <span className="row__value muted">Vérification…</span>
  if (status.state === 'error') return <span className="row__value warn">{status.message}</span>
  return ok ? <span className="row__value ok">Disponible</span> : <span className="row__value muted">Non configurée</span>
}
