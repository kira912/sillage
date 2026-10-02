import { checkAccess, error, guard, json, readJson } from './_lib/http.js'
import { getSpaceStore, type SpaceEntry } from './_lib/space-store.js'

const MAX_BLOB = 64_000
const MAX_CHANGES = 200
const MAX_NOTES = 5000
const ID_RE = /^[A-Za-z0-9_-]{8,100}$/
/** Identifiant d'espace : empreinte SHA-256 (hex) du code d'invitation, calculée sur le téléphone. */
const SPACE_RE = /^[a-f0-9]{64}$/

interface Body {
  action?: unknown
  space?: unknown
  meta?: unknown
  member?: { id?: unknown; blob?: unknown }
  since?: unknown
  changes?: unknown
}

const isBlob = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= MAX_BLOB

/**
 * Espace partagé, actions :
 * - `create` / `join` : crée ou rejoint l'espace (le téléphone fournit l'identifiant dérivé du code d'invitation) ;
 * - `sync` : envoie les notes modifiées (avec la version sur laquelle elles se basent) et reçoit les changements des autres ;
 * - `leave` : retire ce téléphone de la liste des membres.
 */
export const POST = guard(async (request: Request) => {
  const denied = checkAccess(request)
  if (denied) return denied

  const body = await readJson<Body>(request, 4_000_000)
  if (!body || typeof body.space !== 'string' || !SPACE_RE.test(body.space)) return error(400, 'Espace invalide')
  const space = body.space
  const member = body.member
  if (!member || typeof member.id !== 'string' || !ID_RE.test(member.id)) return error(400, 'Membre invalide')
  const memberId = member.id
  const store = getSpaceStore()
  const touchMember = () =>
    isBlob(member.blob) ? store.upsertMember(space, { id: memberId, blob: member.blob, lastSeen: Date.now() }) : Promise.resolve()

  switch (body.action) {
    case 'create': {
      if (!isBlob(body.meta)) return error(400, 'Données d’espace invalides')
      if (!(await store.create(space, body.meta))) return error(409, 'Cet espace existe déjà')
      await touchMember()
      return json({ ok: true })
    }

    case 'join': {
      if (!(await store.exists(space))) return error(404, 'Aucun espace ne correspond à ce code')
      await touchMember()
      return json({ meta: await store.getMeta(space), members: await store.members(space) })
    }

    case 'sync': {
      if (!(await store.exists(space))) return error(404, 'Cet espace n’existe plus')
      const since = Number.isInteger(body.since) && (body.since as number) >= 0 ? (body.since as number) : 0
      const changes = Array.isArray(body.changes) ? body.changes : []
      if (changes.length > MAX_CHANGES) return error(413, 'Trop de changements à la fois')

      const accepted: { id: string; rev: number }[] = []
      const conflicts: SpaceEntry[] = []
      let count = await store.noteCount(space)
      for (const c of changes as { id?: unknown; baseRev?: unknown; blob?: unknown }[]) {
        if (typeof c?.id !== 'string' || !ID_RE.test(c.id)) continue
        const baseRev = Number.isInteger(c.baseRev) ? (c.baseRev as number) : 0
        const blob = c.blob === null ? null : isBlob(c.blob) ? c.blob : undefined
        if (blob === undefined) continue
        if (blob && baseRev === 0 && ++count > MAX_NOTES) return error(413, 'Espace plein')
        const result = await store.applyChange(space, c.id, baseRev, blob)
        if (result.ok) accepted.push({ id: c.id, rev: result.rev })
        else conflicts.push(result.current)
      }

      if (isBlob(body.meta)) await store.setMeta(space, body.meta)
      await touchMember()
      const { rev, entries } = await store.changesSince(space, since)
      return json({ rev, entries, accepted, conflicts, meta: await store.getMeta(space), members: await store.members(space) })
    }

    case 'leave': {
      if (await store.exists(space)) await store.removeMember(space, memberId)
      return json({ ok: true })
    }

    default:
      return error(400, 'Action inconnue')
  }
})
