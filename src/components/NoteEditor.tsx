import { useLiveQuery } from 'dexie-react-hooks'
import {
  Bell,
  CalendarDays,
  CalendarPlus,
  ChevronLeft,
  Clock,
  Copy,
  Flag,
  ListChecks,
  ListRestart,
  MapPin,
  Minus,
  MoreHorizontal,
  Palette,
  Pin,
  Plus,
  Repeat,
  Tag,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { checklistProgress, removeChecked, uncheckAll } from '../lib/checklist'
import { activeNotes, db, duplicateNote, isEmptyNote, newNote, restoreNote, trashNote } from '../lib/db'
import { WEEKDAYS_SHORT, WEEK_ORDER, describeReminder, fmt, fromKey, relativeDay, toKey } from '../lib/dates'
import { addToCalendar } from '../lib/ics'
import { NOTE_COLORS, type Freq, type Note } from '../lib/types'
import { useToast } from './Toast'

interface Props {
  /** Id d'une note existante, ou null pour une nouvelle note. */
  id: string | null
  defaults?: Partial<Note>
  onClose: () => void
  /** Ouvre une autre note à la place de celle-ci (après duplication). */
  onReplace: (id: string) => void
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
const REMINDERS_TIMED = [0, 10, 30, 60, 120, 1440]
const REMINDERS_ALLDAY = [0, 1440]

const normalizeTag = (t: string) => t.replace(/^#/, '').trim().toLowerCase()

export function NoteEditor({ id, defaults, onClose, onReplace }: Props) {
  const [draft, setDraft] = useState<Note | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const latest = useRef<Note | null>(null)
  const deleted = useRef(false)
  const toast = useToast()
  const notes = useLiveQuery(activeNotes, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const n = (id && (await db.notes.get(id))) || newNote(defaults)
      if (!cancelled) setDraft(n)
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
    const t = setTimeout(() => persist(draft), 400)
    return () => clearTimeout(t)
  }, [draft])

  useEffect(() => () => void (latest.current && persist(latest.current)), [])

  // La zone de texte grandit avec son contenu.
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [draft?.body])

  function persist(n: Note) {
    if (deleted.current) return
    if (isEmptyNote(n)) db.notes.delete(n.id)
    else db.notes.put(n)
  }

  if (!draft) return null

  const set = (patch: Partial<Note>) => setDraft((d) => (d ? { ...d, ...patch, updatedAt: Date.now() } : d))
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
    if (t && !draft!.tags.includes(t)) set({ tags: [...draft!.tags, t] })
  }

  function onTagKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      e.preventDefault()
      addTag(tagInput)
    } else if (e.key === 'Backspace' && !tagInput && draft!.tags.length) {
      set({ tags: draft!.tags.slice(0, -1) })
    }
  }

  function insertChecklist() {
    const el = bodyRef.current
    const body = draft!.body
    const pos = el?.selectionStart ?? body.length
    const prefix = pos > 0 && body[pos - 1] !== '\n' ? '\n- [ ] ' : '- [ ] '
    set({ body: body.slice(0, pos) + prefix + body.slice(pos) })
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(pos + prefix.length, pos + prefix.length)
    })
  }

  // Entrée sur une ligne « - [ ] … » continue la liste ; sur une ligne vide de liste, on en sort.
  function onBodyKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || e.shiftKey) return
    const el = e.currentTarget
    const pos = el.selectionStart
    const body = draft!.body
    const lineStart = body.lastIndexOf('\n', pos - 1) + 1
    const m = body.slice(lineStart, pos).match(/^(\s*)- \[[ x]\] ?(.*)$/i)
    if (!m) return
    e.preventDefault()
    if (!m[2].trim()) {
      set({ body: body.slice(0, lineStart) + body.slice(pos) })
      requestAnimationFrame(() => el.setSelectionRange(lineStart, lineStart))
      return
    }
    const insert = `\n${m[1]}- [ ] `
    set({ body: body.slice(0, pos) + insert + body.slice(pos) })
    requestAnimationFrame(() => el.setSelectionRange(pos + insert.length, pos + insert.length))
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
    setMenuOpen(false)
    addToCalendar(draft!)
  }

  const reminderOptions = draft.time ? REMINDERS_TIMED : REMINDERS_ALLDAY
  const [unitOne, unitMany] = rec ? FREQ_UNITS[rec.freq] : ['', '']

  return (
    <div className={`editor${draft.color ? ` editor--${draft.color}` : ''}`}>
      <header className="editor__bar">
        <button className="back-btn" onClick={onClose}>
          <ChevronLeft size={22} /> Retour
        </button>
        <div className="editor__actions">
          <button className="icon-btn" onClick={insertChecklist} aria-label="Ajouter une case à cocher">
            <ListChecks size={20} />
          </button>
          <button
            className={`icon-btn${draft.pinned ? ' icon-btn--on' : ''}`}
            onClick={() => set({ pinned: !draft.pinned })}
            aria-label={draft.pinned ? 'Désépingler' : 'Épingler'}
            aria-pressed={draft.pinned}
          >
            <Pin size={20} />
          </button>
          <button className="icon-btn" onClick={() => setMenuOpen(!menuOpen)} aria-label="Plus d’actions">
            <MoreHorizontal size={20} />
          </button>
        </div>

      </header>

      {menuOpen && (
        <>
          <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />
          <div className="menu" role="menu">
            {draft.date && (
              <MenuItem icon={<CalendarPlus size={18} />} onClick={exportToCalendar}>
                Ajouter au Calendrier
              </MenuItem>
            )}
            {progress.done > 0 && (
              <>
                <MenuItem icon={<ListRestart size={18} />} onClick={() => (set({ body: uncheckAll(draft.body) }), setMenuOpen(false))}>
                  Tout décocher
                </MenuItem>
                <MenuItem icon={<X size={18} />} onClick={() => (set({ body: removeChecked(draft.body) }), setMenuOpen(false))}>
                  Retirer les éléments cochés
                </MenuItem>
              </>
            )}
            {!isEmptyNote(draft) && (
              <MenuItem icon={<Copy size={18} />} onClick={duplicate}>
                Dupliquer
              </MenuItem>
            )}
            <MenuItem icon={<Trash2 size={18} />} onClick={remove} danger>
              Supprimer
            </MenuItem>
          </div>
        </>
      )}

      <div className="editor__content">
        <input
          className="editor__title"
          placeholder="Titre"
          value={draft.title}
          autoFocus={!id}
          enterKeyHint="next"
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), bodyRef.current?.focus())}
          onChange={(e) => set({ title: e.target.value })}
        />
        <textarea
          ref={bodyRef}
          className="editor__body"
          placeholder="Écrire quelque chose…"
          value={draft.body}
          rows={6}
          onKeyDown={onBodyKeyDown}
          onChange={(e) => set({ body: e.target.value })}
        />

        <div className="group">
          <Row icon={<CalendarDays size={18} />} label="Date" onClear={draft.date ? () => setDate('') : undefined}>
            <Picker
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
                  type="time"
                  value={draft.time ?? ''}
                  display={draft.time ?? 'Toute la journée'}
                  onChange={(v) => set({ time: v || undefined })}
                />
              </Row>

              <Row icon={<Repeat size={18} />} label="Répéter">
                <SelectPicker
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

          <div className="row">
            <span className="row__icon"><Palette size={18} /></span>
            <div className="swatches">
              <button
                className={`swatch swatch--none${!draft.color ? ' swatch--on' : ''}`}
                onClick={() => set({ color: undefined })}
                aria-label="Sans couleur"
              />
              {NOTE_COLORS.map((c) => (
                <button
                  key={c}
                  className={`swatch swatch--${c}${draft.color === c ? ' swatch--on' : ''}`}
                  onClick={() => set({ color: c })}
                  aria-label={c}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Row({ icon, label, children, onClear }: { icon: ReactNode; label: string; children: ReactNode; onClear?: () => void }) {
  return (
    <div className="row">
      <span className="row__icon">{icon}</span>
      <span className="row__label">{label}</span>
      <div className="row__value">{children}</div>
      {onClear && (
        <button className="row__clear" onClick={onClear} aria-label={`Retirer ${label.toLowerCase()}`}>
          <X size={16} />
        </button>
      )}
    </div>
  )
}

/** Sélecteur natif (roue de l'iPhone) caché sous un libellé lisible. */
function Picker({
  type,
  value,
  display,
  min,
  onChange,
}: {
  type: 'date' | 'time'
  value: string
  display: string
  min?: string
  onChange: (v: string) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <span className={`picker${value ? '' : ' picker--empty'}`}>
      {display}
      <input
        ref={ref}
        className="picker__native"
        type={type}
        value={value}
        min={min}
        onClick={() => {
          try {
            ref.current?.showPicker()
          } catch {
            /* showPicker non supporté : le champ natif s'ouvre tout seul */
          }
        }}
        onChange={(e) => onChange(e.target.value)}
      />
    </span>
  )
}

function SelectPicker({
  value,
  display,
  options,
  onChange,
}: {
  value: string
  display: string
  options: [string, string][]
  onChange: (v: string) => void
}) {
  return (
    <span className={`picker${value ? '' : ' picker--empty'}`}>
      {display}
      <select className="picker__native" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, label]) => (
          <option key={v} value={v}>{label}</option>
        ))}
      </select>
    </span>
  )
}

function MenuItem({ icon, children, onClick, danger }: { icon: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button className={`menu__item${danger ? ' menu__item--danger' : ''}`} role="menuitem" onClick={onClick}>
      {icon}
      {children}
    </button>
  )
}
