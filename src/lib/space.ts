import { useSyncExternalStore } from 'react'
import { api, getAccessCode, setAccessCode } from './api'
import { db, newId } from './db'
import { SECRET_RE, decryptJson, encryptJson, generateSecret, keyFor, spaceIdFor } from './space-crypto'
import type { Note } from './types'

/* ------------------------------------------------------------------------------------------------
 * État local de l'espace partagé (un seul espace par téléphone)
 * ---------------------------------------------------------------------------------------------- */

export interface SpaceMember {
  id: string
  name: string
  lastSeen: number
}

export interface SpaceState {
  secret: string
  spaceId: string
  name: string
  /** Étiquettes qui rendent une note partagée automatiquement. */
  tags: string[]
  memberId: string
  memberName: string
  members: SpaceMember[]
  /** Dernière version serveur reçue. */
  cursor: number
  /** Nom ou étiquettes modifiés localement, à envoyer. */
  metaDirty?: boolean
  lastSync?: number
  lastError?: string
}

interface SpaceMeta {
  name: string
  tags: string[]
}

interface NotePayload {
  note: Omit<Note, 'shared' | 'editedBy'>
  by: string
}

const STATE_KEY = 'sillage:space'
const listeners = new Set<() => void>()
let cached: SpaceState | null | undefined

function readState(): SpaceState | null {
  if (cached !== undefined) return cached
  try {
    cached = JSON.parse(localStorage.getItem(STATE_KEY) ?? 'null')
  } catch {
    cached = null
  }
  return cached ?? null
}

function writeState(state: SpaceState | null) {
  cached = state
  try {
    if (state) localStorage.setItem(STATE_KEY, JSON.stringify(state))
    else localStorage.removeItem(STATE_KEY)
  } catch {
    /* stockage indisponible : l'état reste en mémoire pour la session */
  }
  listeners.forEach((l) => l())
}

const patchState = (patch: Partial<SpaceState>) => {
  const s = readState()
  if (s) writeState({ ...s, ...patch })
}

export const getSpace = readState

export function useSpace(): SpaceState | null {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    readState,
  )
}

/* ------------------------------------------------------------------------------------------------
 * Invitation : « secret.codeAccès », pour rejoindre en une seule étape
 * ---------------------------------------------------------------------------------------------- */

export function inviteCode(state: SpaceState): string {
  const access = getAccessCode()
  return access ? `${state.secret}.${access}` : state.secret
}

export function inviteLink(state: SpaceState): string {
  return `${location.origin}/#rejoindre=${encodeURIComponent(inviteCode(state))}`
}

/** Accepte un lien d'invitation complet ou le code seul. */
export function parseInvite(input: string): { secret: string; access?: string } | null {
  const raw = decodeURIComponent(input.trim().match(/rejoindre=([^&\s]+)/)?.[1] ?? input.trim())
  const [secret, ...rest] = raw.split('.')
  if (!SECRET_RE.test(secret)) return null
  return { secret, access: rest.join('.') || undefined }
}

/* ------------------------------------------------------------------------------------------------
 * Création, arrivée, départ
 * ---------------------------------------------------------------------------------------------- */

async function memberBlob(key: CryptoKey, name: string) {
  return encryptJson(key, { name })
}

export async function createSpace(name: string, memberName: string) {
  const secret = generateSecret()
  const [spaceId, key] = await Promise.all([spaceIdFor(secret), keyFor(secret)])
  const memberId = newId()
  const tags = ['courses', 'famille']
  await api('space', {
    body: {
      action: 'create',
      space: spaceId,
      meta: await encryptJson(key, { name, tags } satisfies SpaceMeta),
      member: { id: memberId, blob: await memberBlob(key, memberName) },
    },
  })
  writeState({ secret, spaceId, name, tags, memberId, memberName, members: [{ id: memberId, name: memberName, lastSeen: Date.now() }], cursor: 0 })
}

export async function joinSpace(invite: string, memberName: string) {
  const parsed = parseInvite(invite)
  if (!parsed) throw new Error('Code d’invitation invalide')
  if (parsed.access) setAccessCode(parsed.access)
  const [spaceId, key] = await Promise.all([spaceIdFor(parsed.secret), keyFor(parsed.secret)])
  const memberId = newId()
  const res = await api<{ meta: string; members: { id: string; blob: string; lastSeen: number }[] }>('space', {
    body: { action: 'join', space: spaceId, member: { id: memberId, blob: await memberBlob(key, memberName) } },
  })
  const meta = await decryptJson<SpaceMeta>(key, res.meta).catch(() => {
    throw new Error('Code d’invitation invalide')
  })
  writeState({
    secret: parsed.secret,
    spaceId,
    name: meta.name,
    tags: meta.tags,
    memberId,
    memberName,
    members: await decryptMembers(key, res.members),
    cursor: 0,
  })
  await syncSpace()
}

/** Quitter l'espace : les notes partagées restent sur ce téléphone, en notes personnelles. */
export async function leaveSpace() {
  const s = readState()
  if (!s) return
  // D'abord couper la synchro et attendre celle en cours : sinon elle pourrait réinscrire ce téléphone après son départ.
  writeState(null)
  await running?.catch(() => {})
  await api('space', { body: { action: 'leave', space: s.spaceId, member: { id: s.memberId } } }).catch(() => {})
  await db.transaction('rw', db.notes, db.sync, async () => {
    await db.notes.filter((n) => !!n.shared).modify({ shared: false })
    await db.sync.clear()
  })
}

export function updateSpaceMeta(patch: Partial<SpaceMeta>) {
  patchState({ ...patch, metaDirty: true })
  void syncSpace()
}

/** Une note avec une étiquette partagée devient partagée (à la création ou quand on ajoute l'étiquette). */
export function shouldAutoShare(tags: string[]): boolean {
  const s = readState()
  return !!s && tags.some((t) => s.tags.includes(t))
}

/* ------------------------------------------------------------------------------------------------
 * Synchronisation
 * ---------------------------------------------------------------------------------------------- */

const LOCAL_ONLY: (keyof Note)[] = ['shared', 'editedBy']

function strip(note: Note): NotePayload['note'] {
  const copy: Partial<Note> = { ...note }
  for (const k of LOCAL_ONLY) delete copy[k]
  return copy as NotePayload['note']
}

/** Empreinte stable du contenu partagé (indépendante de l'ordre des clés). */
export function fingerprint(note: Note): string {
  const data = strip(note) as Record<string, unknown>
  return JSON.stringify(Object.keys(data).sort().map((k) => [k, data[k]]))
}

async function decryptMembers(key: CryptoKey, raw: { id: string; blob: string; lastSeen: number }[]) {
  const out: SpaceMember[] = []
  for (const m of raw) {
    const data = await decryptJson<{ name: string }>(key, m.blob).catch(() => null)
    if (data) out.push({ id: m.id, name: data.name, lastSeen: m.lastSeen })
  }
  return out
}

interface Entry {
  id: string
  rev: number
  blob: string | null
}

interface SyncResponse {
  rev: number
  entries: Entry[]
  accepted: { id: string; rev: number }[]
  conflicts: Entry[]
  meta: string | null
  members: { id: string; blob: string; lastSeen: number }[]
}

const BATCH = 150
let running: Promise<void> | null = null
let rerun = false

/** Lance une synchronisation (une seule à la fois ; un appel pendant l'exécution en déclenche une autre ensuite). */
export function syncSpace(): Promise<void> {
  if (running) {
    rerun = true
    return running
  }
  running = runSync()
    .then(() => patchState({ lastSync: Date.now(), lastError: undefined }))
    .catch((e: Error) => patchState({ lastError: e.message }))
    .finally(() => {
      running = null
      if (rerun) {
        rerun = false
        void syncSpace()
      }
    })
  return running
}

async function runSync() {
  const s = readState()
  if (!s || !navigator.onLine) return
  const key = await keyFor(s.secret)

  // 1. Ce qui a changé ici depuis la dernière synchronisation.
  const [notes, metas] = await Promise.all([db.notes.toArray(), db.sync.toArray()])
  const metaById = new Map(metas.map((m) => [m.id, m]))
  const noteById = new Map(notes.map((n) => [n.id, n]))
  const changes: { id: string; baseRev: number; blob: string | null }[] = []
  const sentFp = new Map<string, string | null>()

  for (const n of notes) {
    if (!n.shared || changes.length >= BATCH) continue
    const fp = fingerprint(n)
    const meta = metaById.get(n.id)
    if (meta?.fp === fp) continue
    changes.push({ id: n.id, baseRev: meta?.rev ?? 0, blob: await encryptJson(key, { note: strip(n), by: s.memberName } satisfies NotePayload) })
    sentFp.set(n.id, fp)
  }
  // Notes retirées du partage ou supprimées définitivement : on les retire de l'espace.
  for (const m of metas) {
    const n = noteById.get(m.id)
    if ((n && n.shared) || changes.length >= BATCH) continue
    changes.push({ id: m.id, baseRev: m.rev, blob: null })
    sentFp.set(m.id, null)
  }
  if (changes.length >= BATCH) rerun = true

  // 2. Envoi + réception des changements des autres.
  const res = await api<SyncResponse>('space', {
    body: {
      action: 'sync',
      space: s.spaceId,
      member: { id: s.memberId, blob: await memberBlob(key, s.memberName) },
      since: s.cursor,
      changes,
      meta: s.metaDirty ? await encryptJson(key, { name: s.name, tags: s.tags } satisfies SpaceMeta) : undefined,
    },
  })

  // 3. Application locale.
  await db.transaction('rw', db.notes, db.sync, async () => {
    for (const a of res.accepted) {
      const fp = sentFp.get(a.id)
      if (fp === null || fp === undefined) await db.sync.delete(a.id)
      else {
        await db.sync.put({ id: a.id, rev: a.rev, fp })
        await db.notes.update(a.id, { editedBy: s.memberName })
      }
    }
    // En cas de conflit, la version déjà enregistrée sur le serveur l'emporte.
    for (const e of res.conflicts) await applyEntry(key, e, true)
    for (const e of res.entries) await applyEntry(key, e, false)
  })

  const meta = res.meta ? await decryptJson<SpaceMeta>(key, res.meta).catch(() => null) : null
  const current = readState()
  if (!current || current.spaceId !== s.spaceId) return
  writeState({
    ...current,
    cursor: Math.max(current.cursor, res.rev),
    members: await decryptMembers(key, res.members),
    // Si le nom ou les étiquettes ont encore changé pendant l'envoi, on garde la version locale.
    ...(meta && !(current.metaDirty && (current.name !== s.name || current.tags !== s.tags)) ? { name: meta.name, tags: meta.tags, metaDirty: false } : {}),
  })
}

async function applyEntry(key: CryptoKey, e: Entry, force: boolean) {
  const meta = await db.sync.get(e.id)
  if (!force && meta && meta.rev >= e.rev) return // déjà à jour (souvent : notre propre envoi)
  const local = await db.notes.get(e.id)

  // Modifiée ici après le calcul des changements : on garde la version locale, elle partira au prochain passage.
  if (!force && local?.shared && meta && fingerprint(local) !== meta.fp) {
    await db.sync.put({ ...meta, rev: e.rev })
    return
  }

  if (e.blob === null) {
    // Retirée de l'espace par l'autre personne : la copie locale part à la corbeille (récupérable).
    if (local?.shared) await db.notes.update(e.id, { shared: false, deletedAt: local.deletedAt ?? Date.now() })
    await db.sync.delete(e.id)
    return
  }

  const payload = await decryptJson<NotePayload>(key, e.blob).catch(() => null)
  if (!payload) return
  const note: Note = { ...payload.note, shared: true, editedBy: payload.by }
  await db.notes.put(note)
  await db.sync.put({ id: e.id, rev: e.rev, fp: fingerprint(note) })
}
