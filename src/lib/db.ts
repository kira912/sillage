import Dexie, { type ObservabilitySet, type Table } from 'dexie'
import { sanitizeNote } from './note-schema'
import type { Note, SyncMeta } from './types'

class SillageDB extends Dexie {
  notes!: Table<Note, string>
  sync!: Table<SyncMeta, string>

  constructor() {
    super('sillage')
    this.version(1).stores({
      notes: 'id, updatedAt, date, *tags',
    })
    this.version(2).stores({
      notes: 'id, updatedAt, date, *tags',
      sync: 'id',
    })
  }
}

export const db = new SillageDB()

const NOTES_PART = `idb://${db.name}/notes/`

/**
 * Appelle `listener` après chaque modification des notes, sans relire la table
 * (contrairement à `useLiveQuery`, qui recharge toutes les notes à chaque fois).
 */
export function onNotesChanged(listener: () => void): () => void {
  const handler = (parts: ObservabilitySet) => {
    if (Object.keys(parts).some((part) => part.startsWith(NOTES_PART))) listener()
  }
  Dexie.on.storagemutated.subscribe(handler)
  return () => Dexie.on.storagemutated.unsubscribe(handler)
}

const TRASH_RETENTION_MS = 30 * 24 * 3600 * 1000

// crypto.randomUUID n'existe qu'en contexte sécurisé (https / localhost) :
// on garde un repli pour les tests en http sur le réseau local.
export function newId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return crypto.randomUUID()
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

export function newNote(partial: Partial<Note> = {}): Note {
  const now = Date.now()
  return {
    id: newId(),
    title: '',
    body: '',
    tags: [],
    pinned: false,
    doneDates: [],
    createdAt: now,
    updatedAt: now,
    ...partial,
  }
}

export function isEmptyNote(n: Note): boolean {
  return !n.title.trim() && !n.body.trim()
}

/** Notes actives (hors corbeille), les plus récemment modifiées en premier. */
export const activeNotes = () =>
  db.notes
    .orderBy('updatedAt')
    .reverse()
    .filter((n) => !n.deletedAt)
    .toArray()

export const trashedNotes = () =>
  db.notes
    .orderBy('updatedAt')
    .reverse()
    .filter((n) => !!n.deletedAt)
    .toArray()

export const trashNote = (id: string) => db.notes.update(id, { deletedAt: Date.now() })
export const restoreNote = (id: string) => db.notes.update(id, { deletedAt: undefined })

export async function emptyTrash() {
  const ids = (await trashedNotes()).map((n) => n.id)
  await db.notes.bulkDelete(ids)
}

export async function purgeOldTrash() {
  const limit = Date.now() - TRASH_RETENTION_MS
  const old = await db.notes.filter((n) => !!n.deletedAt && n.deletedAt < limit).primaryKeys()
  await db.notes.bulkDelete(old)
}

export async function duplicateNote(note: Note): Promise<string> {
  const copy = newNote({
    ...note,
    id: newId(),
    title: note.title ? `${note.title} (copie)` : '',
    doneDates: [],
    pinned: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })
  await db.notes.add(copy)
  return copy.id
}

export async function toggleDone(note: Note, dayKey: string) {
  const doneDates = note.doneDates.includes(dayKey)
    ? note.doneDates.filter((d) => d !== dayKey)
    : [...note.doneDates, dayKey]
  await db.notes.update(note.id, { doneDates })
}

export async function exportJson(): Promise<string> {
  const notes = await db.notes.toArray()
  return JSON.stringify({ app: 'sillage', version: 1, exportedAt: new Date().toISOString(), notes }, null, 2)
}

/**
 * Restaure une sauvegarde. Les notes mal formées sont ignorées ; une note déjà présente n'est remplacée
 * que si la sauvegarde en contient une version plus récente.
 */
export async function importJson(text: string): Promise<number> {
  const data = JSON.parse(text)
  const raw: unknown = Array.isArray(data) ? data : data?.notes
  if (!Array.isArray(raw)) throw new Error('Fichier invalide')
  const valid = raw.flatMap((n) => sanitizeNote(n) ?? [])
  return db.transaction('rw', db.notes, async () => {
    const existing = await db.notes.bulkGet(valid.map((n) => n.id))
    const newer = valid.filter((n, i) => !existing[i] || n.updatedAt > existing[i]!.updatedAt)
    await db.notes.bulkPut(newer)
    return newer.length
  })
}

/** Remet au bon format les notes enregistrées (et supprime celles qui sont inutilisables). Renvoie le nombre de corrections. */
export async function repairNotes(): Promise<number> {
  return db.transaction('rw', db.notes, async () => {
    const all = await db.notes.toArray()
    const invalid: string[] = []
    const fixed: Note[] = []
    for (const raw of all) {
      const note = sanitizeNote(raw)
      if (!note) invalid.push((raw as { id: string }).id)
      else if (JSON.stringify(note) !== JSON.stringify(raw)) fixed.push(note)
    }
    await db.notes.bulkDelete(invalid)
    await db.notes.bulkPut(fixed)
    return invalid.length + fixed.length
  })
}

/**
 * Import depuis du texte collé (ex. depuis l'app Notes) : les notes sont séparées par une ligne « --- »,
 * la première ligne devient le titre. Les puces « ◦ », « • », « - » sont converties en cases à cocher
 * si `bulletsAsChecklist` est vrai.
 */
export async function importText(text: string, bulletsAsChecklist: boolean): Promise<number> {
  const blocks = text
    .split(/^\s*-{3,}\s*$/m)
    .map((b) => b.trim())
    .filter(Boolean)
  const now = Date.now()
  const notes = blocks.map((block, i) => {
    const [first, ...rest] = block.split('\n')
    let body = rest.join('\n').trim()
    if (bulletsAsChecklist) body = body.replace(/^(\s*)[◦•▪\-*]\s+(?!\[[ x]\])/gim, '$1- [ ] ')
    return newNote({ title: first.trim(), body, createdAt: now, updatedAt: now - i })
  })
  await db.notes.bulkAdd(notes)
  return notes.length
}
