import { Component, useState, type ReactNode } from 'react'
import { saveBackup } from '../lib/backup'
import { repairNotes } from '../lib/db'
import { getSpace, leaveSpace } from '../lib/space'

/**
 * Dernier recours si l'affichage plante (ex. donnée inattendue enregistrée sur le téléphone) :
 * au lieu d'un écran blanc à chaque ouverture, on propose de sauvegarder les notes, de les réparer
 * ou de quitter l'espace partagé, sans passer par le reste de l'interface.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('[sillage] plantage de l’affichage', error)
  }

  render() {
    return this.state.error ? <Recovery error={this.state.error} /> : this.props.children
  }
}

function Recovery({ error }: { error: Error }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function run(action: () => Promise<string | void>) {
    setBusy(true)
    setMessage('')
    try {
      const result = await action()
      if (result) setMessage(result)
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function repair() {
    const count = await repairNotes()
    location.reload()
    return `${count} note(s) corrigée(s)`
  }

  async function leave() {
    if (!confirm('Quitter l’espace partagé ? Les notes partagées resteront sur ce téléphone, en notes personnelles.')) return
    await leaveSpace()
    location.reload()
  }

  return (
    <div className="app">
      <section className="view recovery">
        <h1>Un problème est survenu</h1>
        <p className="muted">
          Sillage n’a pas pu s’afficher. Vos notes sont toujours sur ce téléphone : commencez par en exporter une
          sauvegarde, puis essayez de réparer.
        </p>
        <div className="recovery__actions">
          <button className="btn btn--primary btn--block" disabled={busy} onClick={() => run(saveBackup)}>
            Exporter une sauvegarde
          </button>
          <button className="btn btn--block" disabled={busy} onClick={() => run(repair)}>
            Réparer les notes et relancer
          </button>
          {getSpace() && (
            <button className="btn btn--block" disabled={busy} onClick={() => run(leave)}>
              Quitter l’espace partagé
            </button>
          )}
          <button className="btn btn--block" disabled={busy} onClick={() => location.reload()}>
            Relancer
          </button>
        </div>
        {message && <p className="footnote">{message}</p>}
        <p className="footnote recovery__detail">{error.message}</p>
      </section>
    </div>
  )
}
