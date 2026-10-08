import { useSyncExternalStore } from 'react'
import { api } from './api'
import { db, newId, newNote } from './db'
import { mergeNotes } from './merge'
import { SHOPPING_ID, mergeLists } from './shopping'
import { sanitizeNote } from './note-schema'
import { plainText } from './richtext'
import { SECRET_RE, decryptJson, encryptJson, generateSecret, keyFor, spaceIdFor } from './space-crypto'
import { forgetSpaceKey, pushSubscription, saveSpaceKey, spacePushWanted } from './space-push'
import type { Note, SharedNote } from './types'

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
  /** Toutes les notes de l'espace ont été reçues une fois : les suivantes sont des nouveautés à signaler. */
  caughtUp?: boolean
  /** Clé publique des notifications du serveur (absente s'il n'en envoie pas). */
  vapidKey?: string
  /** Abonnement aux notifications déclaré au serveur pour cet espace (`null` : aucun). */
  pushEndpoint?: string | null
}

/** Résumé chiffré d'un envoi qui ajoute des notes, affiché en notification chez les autres membres. */
export interface SpaceNotice {
  by: string
  count: number
  items: { id: string; title: string; date?: string; time?: string }[]
}
const NOTICE_ITEMS = 3

interface SpaceMeta {
  name: string
  tags: string[]
}

/** Nom et étiquettes de l'espace, déchiffrés et validés (données venant des autres membres). */
async function decryptMeta(key: CryptoKey, blob: string): Promise<SpaceMeta | null> {
  const meta = await decryptJson<Partial<SpaceMeta>>(key, blob).catch(() => null)
  if (!meta || typeof meta.name !== 'string' || !Array.isArray(meta.tags)) return null
  return { name: meta.name, tags: meta.tags.filter((t): t is string => typeof t === 'string') }
}

interface NotePayload {
  note: SharedNote
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
 * Invitation : le code secret de l'espace (il n'inclut plus le code d'accès, réservé à l'IA et aux rappels)
 * ---------------------------------------------------------------------------------------------- */

export function inviteCode(state: SpaceState): string {
  return state.secret
}

export function inviteLink(state: SpaceState): string {
  return `${location.origin}/#rejoindre=${encodeURIComponent(inviteCode(state))}`
}

/** Accepte un lien d'invitation complet ou le code seul (les anciens codes « secret.codeAccès » restent valides). */
export function parseInvite(input: string): string | null {
  const raw = decodeURIComponent(input.trim().match(/rejoindre=([^&\s]+)/)?.[1] ?? input.trim())
  const secret = raw.split('.')[0]
  return SECRET_RE.test(secret) ? secret : null
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
  const secret = parseInvite(invite)
  if (!secret) throw new Error('Code d’invitation invalide')
  const [spaceId, key] = await Promise.all([spaceIdFor(secret), keyFor(secret)])
  const memberId = newId()
  const res = await api<{ meta: string; members: { id: string; blob: string; lastSeen: number }[]; vapidPublicKey?: string | null }>('space', {
    body: { action: 'join', space: spaceId, member: { id: memberId, blob: await memberBlob(key, memberName) } },
  })
  const meta = await decryptMeta(key, res.meta)
  if (!meta) throw new Error('Code d’invitation invalide')
  writeState({
    secret,
    spaceId,
    name: meta.name,
    tags: meta.tags,
    memberId,
    memberName,
    members: await decryptMembers(key, res.members),
    cursor: 0,
    vapidKey: res.vapidPublicKey ?? undefined,
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
  await forgetSpaceKey(s.spaceId)
  await db.transaction('rw', db.notes, db.sync, async () => {
    await db.notes.filter((n) => !!n.shared).modify({ shared: false, unread: undefined })
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

const LOCAL_ONLY: (keyof Note)[] = ['shared', 'editedBy', 'unread']

function strip(note: Note): SharedNote {
  const copy: Partial<Note> = { ...note }
  for (const k of LOCAL_ONLY) delete copy[k]
  return copy as SharedNote
}

/** Empreinte stable du contenu partagé (indépendante de l'ordre des clés ; `undefined` équivaut à absent). */
export function fingerprint(note: Note | SharedNote): string {
  const data = strip(note as Note) as Record<string, unknown>
  return JSON.stringify(
    Object.keys(data)
      .filter((k) => data[k] !== undefined)
      .sort()
      .map((k) => [k, data[k]]),
  )
}

async function decryptMembers(key: CryptoKey, raw: { id: string; blob: string; lastSeen: number }[]) {
  const out: SpaceMember[] = []
  for (const m of raw) {
    const data = await decryptJson<{ name: string }>(key, m.blob).catch(() => null)
    if (data && typeof data.name === 'string') out.push({ id: m.id, name: data.name, lastSeen: m.lastSeen })
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
  /** D'autres changements attendent : une nouvelle synchronisation les récupère. */
  more?: boolean
  accepted: { id: string; rev: number }[]
  conflicts: Entry[]
  /** Changements refusés par le serveur (note trop longue). */
  rejected?: string[]
  /** Espace plein : certaines notes n'ont pas pu être envoyées. */
  full?: boolean
  meta: string | null
  members: { id: string; blob: string; lastSeen: number }[]
  vapidPublicKey?: string | null
}

/** Notes envoyées par synchronisation : nombre et taille (la requête doit rester sous la limite de 4,5 Mo de Vercel). */
const BATCH = 150
const MAX_REQUEST_BYTES = 1_500_000
/** Taille maximale d'une note chiffrée acceptée par le serveur. */
const MAX_BLOB = 64_000

/** Notes trop longues pour être partagées (identifiant → empreinte) : inutile de les rechiffrer à chaque passage. */
const tooLarge = new Map<string, string>()

/** `push` : seulement s'il y a quelque chose à envoyer ; `full` : envoi et réception. */
type SyncMode = 'push' | 'full'

let running: Promise<void> | null = null
/** Espace dont la clé a déjà été confiée au service worker pendant cette session. */
let keySavedFor: string | null = null
let rerun: SyncMode | null = null
/** Dernier changement envoyé ou reçu : la fréquence de synchronisation ralentit quand l'espace est calme. */
let lastActivity = Date.now()

/**
 * Lance une synchronisation (une seule à la fois ; un appel pendant l'exécution en déclenche une autre ensuite).
 * Avec `onlyIfChanges`, aucune requête n'est faite s'il n'y a rien à envoyer (ex. après la modification
 * d'une note personnelle).
 */
export function syncSpace(options: { onlyIfChanges?: boolean } = {}): Promise<void> {
  const mode: SyncMode = options.onlyIfChanges ? 'push' : 'full'
  if (running) {
    if (rerun !== 'full') rerun = mode
    return running
  }
  running = runSync(mode)
    .then(() => patchState({ lastSync: Date.now(), lastError: undefined }))
    .catch((e: Error) => patchState({ lastError: e.message }))
    .finally(() => {
      running = null
      const next = rerun
      rerun = null
      if (next) void syncSpace({ onlyIfChanges: next === 'push' })
    })
  return running
}

/** Délai avant la prochaine synchronisation périodique : 20 s si l'espace est actif, jusqu'à 2 min s'il est calme. */
export function pollDelay(): number {
  const idle = Date.now() - lastActivity
  return idle < 2 * 60_000 ? 20_000 : idle < 10 * 60_000 ? 60_000 : 120_000
}

async function runSync(mode: SyncMode) {
  const s = readState()
  if (!s || !navigator.onLine) return
  const key = await keyFor(s.secret)

  // La liste de courses est toujours celle de l'espace, même faite avant de le rejoindre ou gardée d'un espace
  // quitté depuis. Si l'espace a déjà la sienne, l'envoi est refusé et les deux listes sont réunies (applyEntry).
  await db.notes
    .where('id')
    .equals(SHOPPING_ID)
    .and((n) => !n.shared && !n.deletedAt)
    .modify({ shared: true })

  // Notifications : abonnement de ce téléphone à déclarer (ou retirer) s'il a changé, clé pour le service worker.
  const subscription = spacePushWanted() ? await pushSubscription().catch(() => null) : null
  const endpoint = subscription?.endpoint ?? null
  const pushChange = endpoint !== (s.pushEndpoint ?? null) ? (subscription?.toJSON() ?? null) : undefined
  if (subscription && keySavedFor !== s.spaceId) {
    await saveSpaceKey(s.spaceId, key)
    keySavedFor = s.spaceId
  }

  // 1. Ce qui a changé ici depuis la dernière synchronisation, dans la limite d'un envoi.
  const [notes, metas] = await Promise.all([db.notes.toArray(), db.sync.toArray()])
  const metaById = new Map(metas.map((m) => [m.id, m]))
  const noteById = new Map(notes.map((n) => [n.id, n]))
  const changes: { id: string; baseRev: number; blob: string | null }[] = []
  /** Contenu envoyé pour chaque note (`null` = retrait de l'espace). */
  const sent = new Map<string, SharedNote | null>()
  /** Notes ajoutées à l'espace par cet envoi, ou mises dans l'agenda : les autres membres en sont prévenus. */
  const added: Note[] = []
  let bytes = 0
  let pending = false
  const batchFull = () => changes.length >= BATCH || bytes >= MAX_REQUEST_BYTES

  for (const n of notes) {
    if (!n.shared) continue
    const fp = fingerprint(n)
    if (metaById.get(n.id)?.fp === fp || tooLarge.get(n.id) === fp) continue
    if (batchFull()) {
      pending = true
      break
    }
    const content = strip(n)
    const blob = await encryptJson(key, { note: content, by: s.memberName } satisfies NotePayload)
    if (blob.length > MAX_BLOB) {
      tooLarge.set(n.id, fp)
      continue
    }
    tooLarge.delete(n.id)
    const meta = metaById.get(n.id)
    changes.push({ id: n.id, baseRev: meta?.rev ?? 0, blob })
    sent.set(n.id, content)
    bytes += blob.length
    if (n.id !== SHOPPING_ID && !n.deletedAt && (!meta || (meta.base && !meta.base.date && n.date))) added.push(n)
  }
  // Notes retirées du partage ou supprimées définitivement : on les retire de l'espace.
  for (const m of metas) {
    if (noteById.get(m.id)?.shared) continue
    if (batchFull()) {
      pending = true
      break
    }
    changes.push({ id: m.id, baseRev: m.rev, blob: null })
    sent.set(m.id, null)
  }
  if (mode === 'push' && !changes.length && !s.metaDirty && pushChange === undefined) return

  const notice: SpaceNotice | null = added.length
    ? {
        by: s.memberName,
        count: added.length,
        items: added.slice(0, NOTICE_ITEMS).map((n) => ({ id: n.id, title: plainText(n.title).slice(0, 80), date: n.date, time: n.time })),
      }
    : null

  // 2. Envoi + réception des changements des autres.
  const res = await api<SyncResponse>('space', {
    body: {
      action: 'sync',
      space: s.spaceId,
      member: { id: s.memberId, blob: await memberBlob(key, s.memberName) },
      since: s.cursor,
      changes,
      meta: s.metaDirty ? await encryptJson(key, { name: s.name, tags: s.tags } satisfies SpaceMeta) : undefined,
      push: pushChange,
      notify: notice ? { blob: await encryptJson(key, notice), ids: added.map((n) => n.id) } : undefined,
    },
  })

  // 3. Application locale.
  let needsPush = false
  await db.transaction('rw', db.notes, db.sync, async () => {
    for (const a of res.accepted) {
      const content = sent.get(a.id)
      if (!content) await db.sync.delete(a.id)
      else {
        await db.sync.put({ id: a.id, rev: a.rev, fp: fingerprint(content), base: content })
        await db.notes.update(a.id, { editedBy: s.memberName })
      }
    }
    for (const e of [...res.conflicts, ...res.entries]) {
      if (await applyEntry(key, e, s.memberName, !s.caughtUp)) needsPush = true
    }
  })
  for (const id of res.rejected ?? []) {
    const n = noteById.get(id)
    if (n) tooLarge.set(id, fingerprint(n))
  }
  if (changes.length || res.entries.some((e) => !res.accepted.some((a) => a.id === e.id && a.rev === e.rev))) {
    lastActivity = Date.now()
  }
  // Encore des changements à envoyer ou à recevoir, ou une fusion à renvoyer : on enchaîne.
  if (pending || res.more || needsPush) rerun = 'full'

  const meta = res.meta ? await decryptMeta(key, res.meta) : null
  const current = readState()
  if (!current || current.spaceId !== s.spaceId) return
  writeState({
    ...current,
    cursor: Math.max(current.cursor, res.rev),
    members: await decryptMembers(key, res.members),
    caughtUp: current.caughtUp || !res.more,
    vapidKey: res.vapidPublicKey ?? undefined,
    ...(pushChange !== undefined ? { pushEndpoint: endpoint } : {}),
    // Si le nom ou les étiquettes ont encore changé pendant l'envoi, on garde la version locale.
    ...(meta && !(current.metaDirty && (current.name !== s.name || current.tags !== s.tags)) ? { name: meta.name, tags: meta.tags, metaDirty: false } : {}),
  })

  if (res.full) throw new Error('Espace plein : supprimez des notes partagées pour en ajouter d’autres')
  const blocked = [...tooLarge].flatMap(([id, fp]) => {
    const n = noteById.get(id)
    return n?.shared && fingerprint(n) === fp ? [plainText(n.title) || 'Sans titre'] : []
  })
  if (blocked.length) throw new Error(`Trop longue pour être partagée : « ${blocked.join(' », « ')} »`)
}

/** Copie personnelle d'une version locale qui n'a pas pu être fusionnée, pour ne rien perdre. */
async function saveConflictCopy(local: Note) {
  const now = Date.now()
  await db.notes.add(
    newNote({
      ...strip(local),
      id: newId(),
      title: `${local.title || 'Sans titre'} (version en conflit)`,
      pinned: false,
      createdAt: now,
      updatedAt: now,
    }),
  )
}

/**
 * Applique une version reçue du serveur. Si la note a aussi été modifiée ici depuis la dernière synchronisation,
 * les deux versions sont fusionnées ; renvoie `true` si le résultat doit être renvoyé au serveur.
 * `initial` : première réception des notes de l'espace (en le rejoignant) — rien n'est signalé comme nouveau.
 */
async function applyEntry(key: CryptoKey, e: Entry, memberName: string, initial: boolean): Promise<boolean> {
  const meta = await db.sync.get(e.id)
  if (meta && meta.rev >= e.rev) return false // déjà à jour (souvent : notre propre envoi)
  const local = await db.notes.get(e.id)

  // Retirée du partage ici, pas encore envoyé : ce choix l'emporte, le retrait partira avec la bonne version.
  if (local && !local.shared && meta) {
    await db.sync.put({ ...meta, rev: e.rev })
    return true
  }

  if (e.blob === null) {
    // Retirée de l'espace par l'autre personne : la copie locale part à la corbeille (récupérable).
    if (local?.shared) await db.notes.update(e.id, { shared: false, deletedAt: local.deletedAt ?? Date.now() })
    await db.sync.delete(e.id)
    return false
  }

  const payload = await decryptJson<NotePayload>(key, e.blob).catch(() => null)
  const remote = payload ? sanitizeNote(payload.note, e.id) : null
  if (!remote) {
    // Illisible ou mal formée : ignorée. Notre version, si elle a changé, la remplacera.
    if (meta) await db.sync.put({ ...meta, rev: e.rev })
    return false
  }
  const remoteContent = strip(remote)
  const by = typeof payload?.by === 'string' ? payload.by : undefined

  let next = remoteContent
  let push = false
  const localChanged = !!local?.shared && fingerprint(local) !== (meta?.fp ?? fingerprint(remoteContent))
  if (local && !meta && e.id === SHOPPING_ID && !local.deletedAt) {
    // Liste de courses faite ici avant de connaître celle de l'espace : on réunit les articles des deux.
    next = { ...remoteContent, body: mergeLists(local.body, remoteContent.body) }
    push = fingerprint(next) !== fingerprint(remoteContent)
  } else if (local && localChanged) {
    if (meta?.base) {
      const merged = mergeNotes(meta.base, strip(local), remoteContent)
      next = merged.note
      if (merged.conflict) await saveConflictCopy(local)
    } else {
      await saveConflictCopy(local)
    }
    push = fingerprint(next) !== fingerprint(remoteContent)
  }

  // Nouvelle pour ce téléphone : ajoutée par quelqu'un d'autre, ou mise dans l'agenda par quelqu'un d'autre.
  const fromOther = !initial && by !== memberName && !next.deletedAt && e.id !== SHOPPING_ID
  const unread = fromOther && (!local || (!local.date && !!next.date)) ? true : next.deletedAt ? undefined : local?.unread

  await db.notes.put({ ...next, shared: true, editedBy: push ? memberName : by, unread })
  await db.sync.put({ id: e.id, rev: e.rev, fp: fingerprint(remoteContent), base: remoteContent })
  return push
}
