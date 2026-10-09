import { useLiveQuery } from 'dexie-react-hooks'
import { Bell, CalendarDays, ChevronLeft, ListChecks, Mic, Repeat, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ApiError, api, type Quota } from '../lib/api'
import { CHECK_RE, checklistProgress } from '../lib/checklist'
import { activeNotes, db, newNote } from '../lib/db'
import { describeRecurrence, describeReminder, fromKey, relativeDay, toKey } from '../lib/dates'
import { addToList, updateList } from '../lib/shopping'
import { shouldAutoShare } from '../lib/space'
import type { Note } from '../lib/types'
import { useToast } from './Toast'

type Draft = Pick<Note, 'title' | 'body' | 'tags' | 'date' | 'time' | 'recurrence' | 'reminder'>

const EXAMPLES = [
  'Pédiatre de Léa jeudi à 14h30, apporter le carnet de santé',
  'Tous les mardis sortir les poubelles à 20h',
  'Courses : lait, pain, tomates, lessive',
]

/** Brouillon « Courses : lait, pain… » : ses articles vont dans la liste de courses plutôt que dans une nouvelle note. */
function isShoppingDraft(d: Draft): boolean {
  const title = d.title.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
  return /^(liste de )?courses?\b/.test(title) && checklistProgress(d.body).total > 0 && !d.recurrence
}

interface Props {
  /** Texte écrit dans l'éditeur : l'analyse démarre dès l'ouverture. */
  initialText?: string
  onClose: () => void
  onOpenSettings: () => void
}

export function QuickCapture({ initialText = '', onClose, onOpenSettings }: Props) {
  const [text, setText] = useState(initialText)
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [drafts, setDrafts] = useState<Draft[] | null>(null)
  const [selected, setSelected] = useState<boolean[]>([])
  const notes = useLiveQuery(activeNotes, [])
  const toast = useToast()
  /** Quota gratuit restant (sans code d'accès). */
  const [quota, setQuota] = useState<Quota | null>(null)
  /** Quota épuisé : on propose de saisir un code d'accès. */
  const [outOfQuota, setOutOfQuota] = useState(false)
  // Analyse en cours annulée si l'écran est fermé.
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])
  useEffect(() => {
    if (initialText.trim()) void analyze()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function analyze() {
    setLoading(true)
    setErrorMsg('')
    setOutOfQuota(false)
    // Contrôleur propre à cet appel : un appel annulé ne doit pas toucher à l'état d'un appel plus récent.
    const controller = new AbortController()
    request.current?.abort()
    request.current = controller
    try {
      const tags = [...new Set((notes ?? []).flatMap((n) => n.tags))]
      const { notes: result, quota } = await api<{ notes: Draft[]; quota?: Quota }>('parse', {
        body: { text, today: toKey(new Date()), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, tags },
        timeoutMs: 60_000,
        signal: controller.signal,
      })
      setQuota(quota ?? null)
      if (!result.length) setErrorMsg('Rien à noter n’a été trouvé dans ce texte.')
      setDrafts(result.length ? result : null)
      setSelected(result.map(() => true))
    } catch (e) {
      if (controller.signal.aborted) return
      setOutOfQuota(e instanceof ApiError && e.status === 429)
      setErrorMsg(e instanceof ApiError && e.status === 401 ? 'Code d’accès invalide : vérifiez-le dans les réglages.' : (e as Error).message)
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }

  async function addAll() {
    const chosen = drafts!.filter((_, i) => selected[i])
    const shopping = chosen.filter(isShoppingDraft)
    const others = chosen.filter((d) => !isShoppingDraft(d))
    const now = Date.now()
    await db.notes.bulkAdd(others.map((d, i) => newNote({ ...d, shared: shouldAutoShare(d.tags) || undefined, createdAt: now, updatedAt: now + i })))
    // Une liste de courses dictée rejoint la liste de l'onglet Courses (avec sa date, si elle en a une).
    let items = 0
    for (const d of shopping) {
      const lines = d.body.split('\n').flatMap((l) => l.match(CHECK_RE)?.[3] ?? [])
      items += lines.length
      await addToList(lines.join(','))
      if (d.date) await updateList((n) => (n.date ? {} : { date: d.date, time: d.time, reminder: d.reminder, doneDates: [] }))
    }
    const parts = [
      others.length && (others.length > 1 ? `${others.length} notes ajoutées` : 'Note ajoutée'),
      shopping.length && `${items} article${items > 1 ? 's' : ''} ajouté${items > 1 ? 's' : ''} aux courses`,
    ].filter(Boolean)
    toast(parts.join(' · '))
    onClose()
  }

  const count = selected.filter(Boolean).length

  return (
    <div className="editor capture">
      <header className="editor__bar">
        <button className="back-btn" onClick={onClose}>
          <ChevronLeft size={22} /> Retour
        </button>
      </header>

      <div className="editor__content">
        <h1 className="capture__title chart-title">
          <Sparkles size={22} /> Analyse
        </h1>

        {!drafts ? (
          <>
            <textarea
              className="capture__input"
              placeholder="Écrivez ou dictez ce qu’il faut retenir…"
              value={text}
              autoFocus={!initialText}
              rows={5}
              maxLength={2000}
              onChange={(e) => setText(e.target.value)}
            />
            <p className="footnote capture__hint">
              <Mic size={14} className="inline-icon" /> Touchez le micro du clavier pour dicter. Plusieurs choses à la
              fois ? L’IA crée une note pour chacune, avec sa date.
            </p>
            {errorMsg && <p className="capture__error">{errorMsg}</p>}
            {outOfQuota && (
              <button className="btn btn--small" onClick={onOpenSettings}>Entrer un code d’accès</button>
            )}
            <button className="btn btn--primary btn--block" disabled={!text.trim() || loading} onClick={analyze}>
              {loading ? <span className="spinner" /> : <Sparkles size={18} />}
              {loading ? 'Analyse…' : 'Analyser'}
            </button>
            {!text && (
              <div className="capture__examples">
                <p className="section__title">Exemples</p>
                {EXAMPLES.map((ex) => (
                  <button key={ex} className="capture__example" onClick={() => setText(ex)}>
                    « {ex} »
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <p className="muted">Vérifiez avant d’ajouter. Vous pourrez modifier chaque note ensuite.</p>
            {quota && (
              <p className="footnote">
                Analyse gratuite : {quota.remaining > 0 ? `encore ${quota.remaining} sur ${quota.limit} aujourd’hui.` : 'c’était la dernière d’aujourd’hui.'}
              </p>
            )}
            <div className="list">
              {drafts.map((d, i) => (
                <DraftCard
                  key={i}
                  draft={d}
                  checked={selected[i]}
                  onToggle={() => setSelected(selected.map((s, j) => (j === i ? !s : s)))}
                />
              ))}
            </div>
            <div className="btn-row">
              <button className="btn" onClick={() => setDrafts(null)}>Modifier le texte</button>
              <button className="btn btn--primary" disabled={!count} onClick={addAll}>
                {count > 1 ? `Ajouter ${count} notes` : 'Ajouter'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function DraftCard({ draft, checked, onToggle }: { draft: Draft; checked: boolean; onToggle: () => void }) {
  const progress = checklistProgress(draft.body)
  const bodyPreview = draft.body
    .split('\n')
    .map((l) => l.replace(/^\s*- \[[ x]\] ?/i, '• '))
    .join('\n')

  return (
    <label className={`card draft${checked ? '' : ' card--done'}`}>
      <div className="card__head">
        <span className="round-check">
          <input type="checkbox" checked={checked} onChange={onToggle} aria-label="Inclure cette note" />
          <span />
        </span>
        <div className="card__titles">
          {draft.date && (
            <span className="card__time">
              {relativeDay(fromKey(draft.date))}
              {draft.time ? ` · ${draft.time}` : ''}
            </span>
          )}
          {draft.title && <h3 className="card__title">{draft.title}</h3>}
        </div>
      </div>
      {bodyPreview && <div className="card__body">{bodyPreview}</div>}
      <div className="card__meta">
        {progress.total > 0 && (
          <span className="badge"><ListChecks size={13} /> {progress.total} éléments</span>
        )}
        {draft.recurrence && (
          <span className="badge"><Repeat size={13} /> {describeRecurrence(draft.recurrence)}</span>
        )}
        {draft.reminder !== undefined && (
          <span className="badge"><Bell size={13} /> {describeReminder(draft.reminder, !!draft.time)}</span>
        )}
        {!draft.date && <span className="badge badge--past"><CalendarDays size={13} /> Sans date</span>}
        {draft.tags.map((t) => (
          <span key={t} className="tag">#{t}</span>
        ))}
      </div>
    </label>
  )
}
