import { useLiveQuery } from 'dexie-react-hooks'
import {
  Bell,
  CalendarDays,
  CalendarPlus,
  ChevronLeft,
  Clock,
  Copy,
  Flag,
  ListRestart,
  MapPin,
  Minus,
  MoreHorizontal,
  Pin,
  Plus,
  Repeat,
  Sparkles,
  Tag,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { getAccessCode } from '../lib/api'
import { checklistProgress, removeChecked, uncheckAll } from '../lib/checklist'
import { activeNotes, db, duplicateNote, isEmptyNote, newNote, restoreNote, trashNote } from '../lib/db'
import { WEEKDAYS_SHORT, WEEK_ORDER, describeReminder, fmt, fromKey, relativeDay, toKey } from '../lib/dates'
import { addToCalendar } from '../lib/ics'
import { shouldAutoShare, useSpace } from '../lib/space'
import { plainText } from '../lib/richtext'
import { markRead } from '../lib/unread'
import { isShoppingList } from '../lib/shopping'
import { NOTE_COLORS, type Freq, type Note, type NoteColor } from '../lib/types'
import { Picker, Row, SelectPicker } from './Fields'
import { FormatBar } from './FormatBar'
import { RichField, type RichFieldHandle } from './RichField'
import { Segmented } from './Segmented'
import { Sheet, SheetItem } from './Sheet'
import { useToast } from './Toast'

interface Props {
  /** Id d'une note existante, ou null pour une nouvelle note. */
  id: string | null
  defaults?: Partial<Note>
  onClose: () => void
  /** Ouvre une autre note à la place de celle-ci (après duplication). */
  onReplace: (id: string) => void
  /** Nouvelle note : confie le texte à l'IA, qui en tire une ou plusieurs notes datées. */
  onAnalyze: (text: string) => void
}

const FREQ_LABELS: Record<Freq, string> = {
  daily: 'Tous les jours',
  weekly: 'Toutes les semaines',
  monthly: 'Tous les mois',
  yearly: 'Tous les ans',
}
const FREQ_UNITS: Record<Freq, [string, string]> = {
  daily: ['jour', 'jours'],
  weekly: ['semaine', 'semaines'],
  monthly: ['mois', 'mois'],
  yearly: ['an', 'ans'],
}
const COLOR_LABELS: Record<NoteColor, string> = {
  coral: 'Corail',
  sand: 'Sable',
  sage: 'Sauge',
  sky: 'Ciel',
  lavender: 'Lavande',
  rose: 'Rose',
}
const REMINDERS_TIMED = [0, 10, 30, 60, 120, 1440]
const REMINDERS_ALLDAY = [0, 1440]

const normalizeTag = (t: string) => t.replace(/^#/, '').trim().toLowerCase()

export function NoteEditor({ id, defaults, onClose, onReplace, onAnalyze }: Props) {
  const [draft, setDraft] = useState<Note | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const titleRef = useRef<RichFieldHandle>(null)
  const bodyRef = useRef<RichFieldHandle>(null)
  /** Champ visé par la barre de mise en forme : le dernier touché. */
  const [formatting, setFormatting] = useState<'title' | 'body'>('body')
  const latest = useRef<Note | null>(null)
  /** Date à l'ouverture : si elle apparaît ou disparaît, la note change d'onglet, et on le dit. */
  const initialDate = useRef<string | undefined>(undefined)
  const deleted = useRef(false)
  /** Vrai dès que l'utilisateur modifie la note : seulement alors on enregistre. */
  const dirty = useRef(false)
  const toast = useToast()
  const notes = useLiveQuery(activeNotes, [])
  const space = useSpace()

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const n = (id && (await db.notes.get(id))) || newNote({ ...defaults, shared: shouldAutoShare(defaults?.tags ?? []) || undefined })
      if (cancelled) return
      initialDate.current = n.date
      // Ouvrir une nouveauté de l'espace partagé la marque comme vue.
      if (n.unread) {
        delete n.unread
        await markRead((x) => x.id === n.id)
        if (cancelled) return
      }
      setDraft(n)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Sauvegarde automatique (avec un léger délai) + sauvegarde finale à la fermeture.
  useEffect(() => {
    if (!draft) return
    latest.current = draft
    if (!dirty.current) return
    const t = setTimeout(() => persist(draft), 400)
    return () => clearTimeout(t)
  }, [draft])

  useEffect(
    () => () => {
      const n = latest.current
      if (!dirty.current || !n) return
      persist(n)
      if (deleted.current || isEmptyNote(n) || isShoppingList(n)) return
      if (n.date && !initialDate.current) toast('Note rangée dans l’agenda')
      else if (!n.date && initialDate.current) toast('Note rangée dans Notes')
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // Note partagée modifiée par l'autre personne pendant qu'elle est ouverte ici (sans modification locale) :
  // on affiche la nouvelle version.
  const stored = useLiveQuery(() => (id ? db.notes.get(id) : undefined), [id])
  useEffect(() => {
    if (stored && !dirty.current && !deleted.current) setDraft(stored)
  }, [stored])

  function persist(n: Note) {
    if (deleted.current) return
    // Une note existante vidée part à la corbeille (avec son dernier contenu) ; une nouvelle note vide disparaît.
    if (isEmptyNote(n)) void (id ? trashNote(n.id) : db.notes.delete(n.id))
    else db.notes.put(n)
  }

  if (!draft) return null

  const set = (patch: Partial<Note>) => {
    dirty.current = true
    setDraft((d) => (d ? { ...d, ...patch, updatedAt: Date.now() } : d))
  }
  const rec = draft.recurrence
  const progress = checklistProgress(draft.body)
  const weekdays = rec?.byWeekday?.length ? rec.byWeekday : draft.date ? [fromKey(draft.date).getDay()] : []
  const tagSuggestions = [...new Set((notes ?? []).flatMap((n) => n.tags))].filter(
    (t) => !draft.tags.includes(t) && t.startsWith(normalizeTag(tagInput)),
  )

  function setDate(value: string) {
    if (value) set({ date: value })
    else set({ date: undefined, time: undefined, recurrence: undefined, reminder: undefined })
  }

  function setFreq(value: string) {
    if (!value) return set({ recurrence: undefined })
    set({
      recurrence: { freq: value as Freq, interval: rec?.interval ?? 1, until: rec?.until },
      date: draft!.date ?? toKey(new Date()),
    })
  }

  function toggleWeekday(d: number) {
    if (!rec) return
    const next = weekdays.includes(d) ? weekdays.filter((x) => x !== d) : [...weekdays, d]
    set({ recurrence: { ...rec, byWeekday: next.length ? next : undefined } })
  }

  function addTag(raw: string) {
    const t = normalizeTag(raw)
    setTagInput('')
    if (!t || draft!.tags.includes(t)) return
    const tags = [...draft!.tags, t]
    // Ajouter une étiquette partagée (#courses…) partage la note ; on peut toujours la repasser en personnelle.
    set({ tags, ...(!draft!.shared && shouldAutoShare([t]) ? { shared: true } : {}) })
  }

  function onTagKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      e.preventDefault()
      addTag(tagInput)
    } else if (e.key === 'Backspace' && !tagInput && draft!.tags.length) {
      set({ tags: draft!.tags.slice(0, -1) })
    }
  }

  async function remove() {
    const noteId = draft!.id
    deleted.current = true
    setMenuOpen(false)
    if (isEmptyNote(draft!)) await db.notes.delete(noteId)
    else {
      await db.notes.put(draft!)
      await trashNote(noteId)
      toast('Note placée dans la corbeille', { label: 'Annuler', run: () => restoreNote(noteId) })
    }
    onClose()
  }

  async function duplicate() {
    setMenuOpen(false)
    await db.notes.put(draft!)
    const copyId = await duplicateNote(draft!)
    toast('Note dupliquée')
    onReplace(copyId)
  }

  function exportToCalendar() {
    addToCalendar(draft!)
  }

  // Le brouillon vide n'est pas gardé : l'analyse crée elle-même les notes.
  async function analyze() {
    const text = [draft!.title, draft!.body].map(plainText).filter((t) => t.trim()).join('\n')
    deleted.current = true
    await db.notes.delete(draft!.id)
    onAnalyze(text)
  }

  const reminderOptions = draft.time ? REMINDERS_TIMED : REMINDERS_ALLDAY
  const canAnalyze = !id && !!getAccessCode() && !!(draft.title.trim() || draft.body.trim())
  const [unitOne, unitMany] = rec ? FREQ_UNITS[rec.freq] : ['', '']

  return (
    <div className={`editor${draft.color ? ` editor--${draft.color}` : ''}`}>
      <header className="editor__bar">
        <button className="back-btn" onClick={onClose}>
          <ChevronLeft size={22} /> Retour
        </button>
        <div className="editor__actions">
          {canAnalyze && (
            <button className="btn btn--small" onClick={analyze}>
              <Sparkles size={16} /> Analyser
            </button>
          )}
          <button
            className={`icon-btn${draft.pinned ? ' icon-btn--on' : ''}`}
            onClick={() => set({ pinned: !draft.pinned })}
            aria-label="Épingler"
            aria-pressed={draft.pinned}
          >
            <Pin size={20} />
          </button>
          <button className="icon-btn" onClick={() => setMenuOpen(true)} aria-label="Plus d’actions" aria-haspopup="dialog">
            <MoreHorizontal size={20} />
          </button>
        </div>
        <FormatBar target={() => (formatting === 'title' ? titleRef : bodyRef).current} field={formatting} />
      </header>

      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title={plainText(draft.title).trim() || 'Cette note'}>
        <div className="sheet__list">
          {progress.done > 0 && (
            <>
              <SheetItem icon={<ListRestart size={20} />} onClick={() => (set({ body: uncheckAll(draft.body) }), setMenuOpen(false))}>
                Tout décocher
              </SheetItem>
              <SheetItem icon={<X size={20} />} onClick={() => (set({ body: removeChecked(draft.body) }), setMenuOpen(false))}>
                Retirer les éléments cochés
              </SheetItem>
            </>
          )}
          {!isEmptyNote(draft) && (
            <SheetItem icon={<Copy size={20} />} onClick={duplicate}>
              Dupliquer
            </SheetItem>
          )}
          <SheetItem icon={<Trash2 size={20} />} onClick={remove} danger>
            Supprimer
          </SheetItem>
        </div>
      </Sheet>

      <div className="editor__content">
        <RichField
          ref={titleRef}
          className="editor__title"
          label="Titre"
          placeholder="Titre"
          value={draft.title}
          autoFocus={!id}
          onEnter={() => bodyRef.current?.focus()}
          onActivate={() => setFormatting('title')}
          onChange={(title) => set({ title })}
        />
        <RichField
          ref={bodyRef}
          multiline
          className="editor__body"
          label="Texte de la note"
          placeholder="Écrire quelque chose…"
          value={draft.body}
          onActivate={() => setFormatting('body')}
          onChange={(body) => set({ body })}
        />

        <div className="group">
          <Row icon={<CalendarDays size={18} />} label="Date" onClear={draft.date ? () => setDate('') : undefined}>
            <Picker
              label="Date"
              type="date"
              value={draft.date ?? ''}
              display={draft.date ? relativeDay(fromKey(draft.date)) : 'Ajouter'}
              onChange={setDate}
            />
          </Row>

          {draft.date && (
            <>
              <Row icon={<Clock size={18} />} label="Heure" onClear={draft.time ? () => set({ time: undefined }) : undefined}>
                <Picker
                  label="Heure"
                  type="time"
                  value={draft.time ?? ''}
                  display={draft.time ?? 'Toute la journée'}
                  onChange={(v) => set({ time: v || undefined })}
                />
              </Row>

              <Row icon={<Repeat size={18} />} label="Répéter">
                <SelectPicker
                  label="Répéter"
                  value={rec?.freq ?? ''}
                  display={rec ? FREQ_LABELS[rec.freq] : 'Jamais'}
                  onChange={setFreq}
                  options={[['', 'Jamais'], ...Object.entries(FREQ_LABELS)]}
                />
              </Row>

              {rec && (
                <>
                  <Row icon={<span />} label="Intervalle">
                    <div className="stepper">
                      <button
                        onClick={() => set({ recurrence: { ...rec, interval: Math.max(1, rec.interval - 1) } })}
                        disabled={rec.interval <= 1}
                        aria-label="Moins"
                      >
                        <Minus size={16} />
                      </button>
                      <span>{rec.interval} {rec.interval > 1 ? unitMany : unitOne}</span>
                      <button onClick={() => set({ recurrence: { ...rec, interval: rec.interval + 1 } })} aria-label="Plus">
                        <Plus size={16} />
                      </button>
                    </div>
                  </Row>

                  {rec.freq === 'weekly' && (
                    <div className="row-block">
                      <div className="weekdays">
                        {WEEK_ORDER.map((d) => (
                          <button
                            key={d}
                            className={`weekday${weekdays.includes(d) ? ' weekday--on' : ''}`}
                            onClick={() => toggleWeekday(d)}
                            aria-pressed={weekdays.includes(d)}
                          >
                            {WEEKDAYS_SHORT[d].slice(0, 1).toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <Row
                    icon={<Flag size={18} />}
                    label="Fin"
                    onClear={rec.until ? () => set({ recurrence: { ...rec, until: undefined } }) : undefined}
                  >
                    <Picker
                      label="Fin de la répétition"
                      type="date"
                      value={rec.until ?? ''}
                      min={draft.date}
                      display={rec.until ? fmt(fromKey(rec.until), 'd MMM yyyy') : 'Jamais'}
                      onChange={(v) => set({ recurrence: { ...rec, until: v || undefined } })}
                    />
                  </Row>
                </>
              )}

              <Row icon={<Bell size={18} />} label="Rappel">
                <SelectPicker
                  label="Rappel"
                  value={draft.reminder === undefined ? '' : String(draft.reminder)}
                  display={draft.reminder === undefined ? 'Aucun' : describeReminder(draft.reminder, !!draft.time)}
                  onChange={(v) => set({ reminder: v === '' ? undefined : Number(v) })}
                  options={[['', 'Aucun'], ...reminderOptions.map((m) => [String(m), describeReminder(m, !!draft.time)] as [string, string])]}
                />
              </Row>

              <button className="group__action" onClick={exportToCalendar}>
                <CalendarPlus size={18} /> Ajouter au Calendrier
                {draft.reminder !== undefined && <small>+ rappel</small>}
              </button>
            </>
          )}
        </div>

        {space && (
          <div className="group">
            <div className="row">
              <span className="row__icon"><Users size={18} /></span>
              <span className="row__label row__label--grow row__label--stack">
                {draft.shared ? space.name : 'Personnelle'}
                <small className="muted">
                  {draft.shared ? (draft.editedBy ? `Modifiée par ${draft.editedBy}` : 'Visible par tout l’espace') : 'Visible par vous seul·e'}
                </small>
              </span>
              <Segmented
                label="Partage"
                value={draft.shared ? 'shared' : 'personal'}
                onChange={(v) => set({ shared: v === 'shared' || undefined })}
                options={[
                  ['personal', 'Perso'],
                  ['shared', 'Partagée'],
                ]}
              />
            </div>
          </div>
        )}

        <div className="group">
          <Row icon={<MapPin size={18} />} label="Lieu" onClear={draft.location ? () => set({ location: undefined }) : undefined}>
            <input
              className="row__input"
              placeholder="Ajouter"
              value={draft.location ?? ''}
              onChange={(e) => set({ location: e.target.value || undefined })}
            />
          </Row>
          {draft.location && (
            <a
              className="group__action"
              href={`https://maps.apple.com/?q=${encodeURIComponent(draft.location)}`}
              target="_blank"
              rel="noreferrer"
            >
              <MapPin size={18} /> Ouvrir dans Plans
            </a>
          )}

          <div className="row row--wrap">
            <span className="row__icon"><Tag size={18} /></span>
            <div className="tags-input">
              {draft.tags.map((t) => (
                <button key={t} className="chip chip--on chip--removable" onClick={() => set({ tags: draft.tags.filter((x) => x !== t) })}>
                  #{t} <X size={12} />
                </button>
              ))}
              <input
                placeholder={draft.tags.length ? 'Ajouter…' : 'Étiquettes'}
                value={tagInput}
                autoCapitalize="none"
                enterKeyHint="done"
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={onTagKeyDown}
                onBlur={() => tagInput && addTag(tagInput)}
              />
            </div>
          </div>
          {tagSuggestions.length > 0 && (
            <div className="row-block">
              <div className="chips">
                {tagSuggestions.slice(0, 12).map((t) => (
                  <button key={t} className="chip" onMouseDown={(e) => e.preventDefault()} onClick={() => addTag(t)}>
                    + #{t}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="row-block">
            <div className="swatches" role="group" aria-label="Couleur">
              <button
                className={`swatch swatch--none${!draft.color ? ' swatch--on' : ''}`}
                onClick={() => set({ color: undefined })}
                aria-label="Sans couleur"
                aria-pressed={!draft.color}
              />
              {NOTE_COLORS.map((c) => (
                <button
                  key={c}
                  className={`swatch swatch--${c}${draft.color === c ? ' swatch--on' : ''}`}
                  onClick={() => set({ color: c })}
                  aria-label={COLOR_LABELS[c]}
                  aria-pressed={draft.color === c}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
