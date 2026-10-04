import { useLiveQuery } from 'dexie-react-hooks'
import { ArchiveRestore, Download, FileText, ShieldCheck, Trash2, Upload } from 'lucide-react'
import { useEffect, useState } from 'react'
import { db, emptyTrash, exportJson, importJson, importText, restoreNote, trashedNotes } from '../lib/db'
import { fmt, toKey } from '../lib/dates'
import { AssistantSettings } from './AssistantSettings'
import { InviteCard, SpaceSettings } from './SpaceSettings'
import { useToast } from './Toast'

export function SettingsView() {
  const count = useLiveQuery(() => db.notes.filter((n) => !n.deletedAt).count(), [])
  const trash = useLiveQuery(trashedNotes, [])
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasted, setPasted] = useState('')
  const [bullets, setBullets] = useState(true)
  const toast = useToast()

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted)
  }, [])

  async function askPersist() {
    const ok = await navigator.storage?.persist?.()
    setPersisted(!!ok)
    toast(ok ? 'Notes protégées' : 'Le navigateur a refusé. Installez l’app sur l’écran d’accueil.')
  }

  async function doExport() {
    const file = new File([await exportJson()], `sillage-${toKey(new Date())}.json`, { type: 'application/json' })
    // Sur iPhone, la feuille de partage permet d'enregistrer dans Fichiers / iCloud Drive.
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Sauvegarde Sillage' })
        return
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
      }
    }
    const a = document.createElement('a')
    a.href = URL.createObjectURL(file)
    a.download = file.name
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
  }

  async function doImport(file: File) {
    try {
      const n = await importJson(await file.text())
      toast(`${n} note(s) importée(s)`)
    } catch (e) {
      toast(`Échec de l'import : ${(e as Error).message}`)
    }
  }

  async function doImportText() {
    const n = await importText(pasted, bullets)
    toast(`${n} note(s) créée(s)`)
    setPasted('')
    setPasteOpen(false)
  }

  return (
    <section className="view">
      <InviteCard />

      <h2 className="section__title">Mes données</h2>
      <div className="group">
        <div className="row">
          <span className="row__icon"><FileText size={18} /></span>
          <span className="row__label">Notes</span>
          <span className="row__value muted">{count ?? '…'}</span>
        </div>
        <div className="row">
          <span className="row__icon"><ShieldCheck size={18} /></span>
          <span className="row__label">Protection contre l’effacement</span>
          {persisted ? (
            <span className="row__value ok">Activée</span>
          ) : (
            <button className="btn btn--small" onClick={askPersist}>Activer</button>
          )}
        </div>
        <button className="group__action" onClick={doExport}>
          <Download size={18} /> Exporter une sauvegarde
        </button>
        <label className="group__action">
          <Upload size={18} /> Restaurer une sauvegarde
          <input type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])} />
        </label>
      </div>
      <p className="footnote">
        Les notes sont stockées uniquement sur ce téléphone. Exportez régulièrement une sauvegarde (vers Fichiers ou iCloud
        Drive).
      </p>

      <SpaceSettings />

      <AssistantSettings />

      <h2 className="section__title">Importer depuis Notes</h2>
      <div className="group">
        {!pasteOpen ? (
          <button className="group__action" onClick={() => setPasteOpen(true)}>
            <FileText size={18} /> Coller des notes existantes
          </button>
        ) : (
          <div className="row-block paste">
            <p className="footnote">
              Copiez une ou plusieurs notes et collez-les ici. Séparez les notes par une ligne contenant{' '}
              <code>---</code>. La première ligne devient le titre.
            </p>
            <textarea
              className="field"
              rows={8}
              value={pasted}
              placeholder={'Courses\n◦ lait\n◦ pain\n---\nIdées cadeaux\nLivre pour maman'}
              onChange={(e) => setPasted(e.target.value)}
            />
            <label className="toggle">
              <input type="checkbox" checked={bullets} onChange={(e) => setBullets(e.target.checked)} />
              Transformer les puces (◦ • -) en cases à cocher
            </label>
            <div className="btn-row">
              <button className="btn" onClick={() => setPasteOpen(false)}>Annuler</button>
              <button className="btn btn--primary" disabled={!pasted.trim()} onClick={doImportText}>Importer</button>
            </div>
          </div>
        )}
      </div>

      <h2 className="section__title">Corbeille</h2>
      <div className="group">
        {!trash?.length ? (
          <div className="row"><span className="muted">La corbeille est vide.</span></div>
        ) : (
          <>
            {trash.map((n) => (
              <div className="row" key={n.id}>
                <span className="row__label row__label--grow">
                  {n.title || n.body.slice(0, 40) || 'Sans titre'}
                  <small className="muted"> · {fmt(new Date(n.deletedAt!), 'd MMM')}</small>
                </span>
                <button className="icon-btn" onClick={() => restoreNote(n.id)} aria-label="Restaurer">
                  <ArchiveRestore size={18} />
                </button>
                <button className="icon-btn" onClick={() => db.notes.delete(n.id)} aria-label="Supprimer définitivement">
                  <Trash2 size={18} />
                </button>
              </div>
            ))}
            <button className="group__action group__action--danger" onClick={() => confirm('Vider la corbeille ?') && emptyTrash()}>
              <Trash2 size={18} /> Vider la corbeille
            </button>
          </>
        )}
      </div>
      <p className="footnote">Les notes de la corbeille sont supprimées automatiquement après 30 jours.</p>

      <h2 className="section__title">Astuces</h2>
      <ul className="tips">
        <li>Avec un espace partagé, les notes #courses ou #famille sont visibles par vous deux, et chacun peut cocher les éléments.</li>
        <li>Touchez ✨ ou « Que faut-il retenir ? » et dictez une phrase : l’IA crée les notes, avec date et répétition.</li>
        <li>Touchez l’icône liste dans une note pour créer des cases à cocher, cochables directement depuis la liste.</li>
        <li>Une liste de courses qui revient chaque semaine : donnez-lui une répétition, puis « Tout décocher » après les courses.</li>
        <li>Pour un rappel sur l’iPhone, choisissez un rappel puis « Ajouter au Calendrier ».</li>
        <li>Glissez une note vers la gauche pour la supprimer (un glissement long la supprime directement).</li>
        <li>Dans l’agenda, glissez sur le calendrier pour changer de mois.</li>
      </ul>
    </section>
  )
}
