import { error, guard, json, readJson } from './_lib/http.js'
import { clientIp, rateLimit } from './_lib/rate-limit.js'
import { getSpaceStore, type SpaceEntry } from './_lib/space-store.js'

const MAX_BLOB = 64_000
const MAX_CHANGES = 200
/** Taille visée d'une page de changements : la réponse doit rester sous la limite de Vercel (4,5 Mo). */
const MAX_RESPONSE_BYTES = 3_000_000
const ID_RE = /^[A-Za-z0-9_-]{8,100}$/
/** Identifiant de note : aléatoire, sauf celui, fixe et plus court, de la liste de courses (« courses »). */
const NOTE_ID_RE = /^[A-Za-z0-9_-]{1,100}$/
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
/** Plafond global de créations par jour, au cas où les abus viendraient de nombreuses adresses IP. */
const MAX_CREATIONS_PER_DAY = 200

/**
 * Espace partagé, actions :
 * - `create` / `join` : crée ou rejoint l'espace (le téléphone fournit l'identifiant dérivé du code d'invitation) ;
 * - `sync` : envoie les notes modifiées (avec la version sur laquelle elles se basent) et reçoit les changements des autres ;
 * - `leave` : retire ce téléphone de la liste des membres (l'espace est supprimé avec le dernier membre).
 *
 * Pas de code d'accès : n'importe qui peut créer son propre espace. Chaque espace est isolé par son identifiant,
 * qu'on ne peut connaître qu'avec le code d'invitation. Contre les abus : appels limités par adresse IP, taille et
 * nombre de membres plafonnés par espace, et un espace inutilisé pendant un an expire.
 */
export const POST = guard(async (request: Request) => {
  const ip = clientIp(request)
  if (!(await rateLimit(`space:${ip}`, 600, 600))) return error(429, 'Trop de requêtes, réessayez dans quelques minutes')

  const body = await readJson<Body>(request, 4_000_000)
  if (!body || typeof body.space !== 'string' || !SPACE_RE.test(body.space)) return error(400, 'Espace invalide')
  const space = body.space
  const member = body.member
  if (!member || typeof member.id !== 'string' || !ID_RE.test(member.id)) return error(400, 'Membre invalide')
  const memberId = member.id
  const store = getSpaceStore()
  const touchMember = () =>
    isBlob(member.blob) ? store.upsertMember(space, { id: memberId, blob: member.blob, lastSeen: Date.now() }) : Promise.resolve(true)
  const tooManyMembers = () => error(403, 'Cet espace a atteint le nombre maximum de membres')

  switch (body.action) {
    case 'create': {
      if (!isBlob(body.meta)) return error(400, 'Données d’espace invalides')
      if (!(await rateLimit(`space-create:${ip}`, 5, 3600))) return error(429, 'Trop d’espaces créés, réessayez dans une heure')
      if (!(await rateLimit('space-create', MAX_CREATIONS_PER_DAY, 24 * 3600)))
        return error(429, 'Trop d’espaces créés aujourd’hui, réessayez demain')
      if (!(await store.create(space, body.meta))) return error(409, 'Cet espace existe déjà')
      await touchMember()
      return json({ ok: true })
    }

    case 'join': {
      if (!(await store.exists(space))) return error(404, 'Aucun espace ne correspond à ce code')
      if (!(await touchMember())) return tooManyMembers()
      await store.touch(space)
      return json({ meta: await store.getMeta(space), members: await store.members(space) })
    }

    case 'sync': {
      if (!(await store.exists(space))) return error(404, 'Cet espace n’existe plus')
      const since = Number.isInteger(body.since) && (body.since as number) >= 0 ? (body.since as number) : 0
      const changes = Array.isArray(body.changes) ? body.changes : []
      if (changes.length > MAX_CHANGES) return error(413, 'Trop de changements à la fois')

      if (!(await touchMember())) return tooManyMembers()
      const accepted: { id: string; rev: number }[] = []
      const conflicts: SpaceEntry[] = []
      /** Changements refusés car invalides (ex. note trop longue) : le téléphone le signale au lieu de les renvoyer. */
      const rejected: string[] = []
      // Espace plein : les changements suivants sont ignorés, le téléphone les renverra quand il y aura de la place.
      let full = false
      // Écritures une par une : chacune est un compare-and-set sur sa propre version.
      for (const c of changes as { id?: unknown; baseRev?: unknown; blob?: unknown }[]) {
        if (typeof c?.id !== 'string' || !NOTE_ID_RE.test(c.id)) continue
        const baseRev = Number.isInteger(c.baseRev) ? (c.baseRev as number) : 0
        const blob = c.blob === null ? null : isBlob(c.blob) ? c.blob : undefined
        if (blob === undefined) {
          rejected.push(c.id)
          continue
        }
        const result = await store.applyChange(space, c.id, baseRev, blob)
        if (result.ok) accepted.push({ id: c.id, rev: result.rev })
        else if ('full' in result) full = true
        else conflicts.push(result.current)
      }

      if (isBlob(body.meta)) await store.setMeta(space, body.meta)
      // Les versions en conflit voyagent dans la même réponse : la page de changements se contente du reste.
      const conflictBytes = conflicts.reduce((sum, e) => sum + (e.blob?.length ?? 0), 0)
      const [page, meta, members] = await Promise.all([
        store.changesSince(space, since, Math.max(2 * MAX_BLOB, MAX_RESPONSE_BYTES - conflictBytes)),
        store.getMeta(space),
        store.members(space),
        store.touch(space),
      ])
      return json({ ...page, accepted, conflicts, rejected, full, meta, members })
    }

    case 'leave': {
      // Le dernier membre parti, l'espace et ses notes sont supprimés.
      if ((await store.exists(space)) && (await store.removeMember(space, memberId)) === 0) await store.delete(space)
      return json({ ok: true })
    }

    default:
      return error(400, 'Action inconnue')
  }
})
