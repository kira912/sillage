import { CHECK_RE } from './checklist'
import type { SharedNote } from './types'

/**
 * Fusion à trois versions d'une note partagée modifiée à la fois ici et sur un autre téléphone.
 * `base` est la dernière version synchronisée commune : un champ modifié d'un seul côté prend la valeur
 * de ce côté. Si les deux côtés ont modifié le même champ, le texte est fusionné ligne par ligne
 * (cocher des éléments différents d'une même liste ne pose aucun problème) ; sinon la version du serveur
 * l'emporte et `conflict` signale qu'une modification locale n'a pas pu être conservée.
 */

/** Champs sans importance en cas de conflit : la version du serveur l'emporte sans le signaler. */
const MINOR_FIELDS = new Set(['pinned', 'color', 'deletedAt', 'createdAt'])

/** Sérialisation stable (ordre des clés indifférent, `undefined` équivaut à absent). */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (v && typeof v === 'object') {
    const entries = Object.entries(v).filter(([, x]) => x !== undefined)
    return `{${entries.sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`).join(',')}}`
  }
  return JSON.stringify(v ?? null)
}

export const sameValue = (a: unknown, b: unknown) => stable(a) === stable(b)

/** Ensemble fusionné : ajouts des deux côtés, sans ce que l'un ou l'autre a retiré. */
export function mergeSets(base: string[] = [], local: string[] = [], remote: string[] = []): string[] {
  const removed = new Set(base.filter((x) => !local.includes(x) || !remote.includes(x)))
  return [...new Set([...local, ...remote])].filter((x) => !removed.has(x))
}

/** Clé d'alignement d'une ligne : une case à cocher garde la même clé, cochée ou non. */
function lineKey(line: string): string {
  const m = line.match(CHECK_RE)
  return m ? `\u0000${m[1]}\u0000${m[3]}` : line
}

const MAX_LCS_CELLS = 4_000_000

/** Plus longue sous-séquence commune : couples d'indices alignés (a[i] === b[j]), croissants. */
function lcsPairs(a: string[], b: string[]): [number, number][] | null {
  const n = a.length
  const m = b.length
  if ((n + 1) * (m + 1) > MAX_LCS_CELLS) return null
  const table = new Uint32Array((n + 1) * (m + 1))
  const at = (i: number, j: number) => i * (m + 1) + j
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[at(i, j)] = a[i] === b[j] ? table[at(i + 1, j + 1)] + 1 : Math.max(table[at(i + 1, j)], table[at(i, j + 1)])
    }
  }
  const pairs: [number, number][] = []
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (a[i] === b[j]) pairs.push([i++, j++])
    else if (table[at(i + 1, j)] >= table[at(i, j + 1)]) i++
    else j++
  }
  return pairs
}

const sameLines = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])

/** Fusion ligne par ligne (principe de diff3) ; `null` si les deux côtés ont modifié le même passage. */
export function mergeLines(base: string, local: string, remote: string): string | null {
  const B = base.split('\n')
  const L = local.split('\n')
  const R = remote.split('\n')
  const toLocal = lcsPairs(B.map(lineKey), L.map(lineKey))
  const toRemote = lcsPairs(B.map(lineKey), R.map(lineKey))
  if (!toLocal || !toRemote) return null
  const localOf = new Map(toLocal)
  const remoteOf = new Map(toRemote)

  // Points d'ancrage : lignes de la base présentes des deux côtés. Entre deux ancrages, chaque côté a un passage.
  const anchors: [number, number, number][] = []
  for (let i = 0; i < B.length; i++) {
    if (localOf.has(i) && remoteOf.has(i)) anchors.push([i, localOf.get(i)!, remoteOf.get(i)!])
  }
  anchors.push([B.length, L.length, R.length])

  const out: string[] = []
  let [b0, l0, r0] = [0, 0, 0]
  for (const [bi, li, ri] of anchors) {
    const [cb, cl, cr] = [B.slice(b0, bi), L.slice(l0, li), R.slice(r0, ri)]
    if (sameLines(cl, cb)) out.push(...cr)
    else if (sameLines(cr, cb) || sameLines(cl, cr)) out.push(...cl)
    // Ajouts des deux côtés au même endroit (ex. deux articles ajoutés en fin de liste) : on garde les deux.
    else if (cb.length === 0) out.push(...cl, ...cr.filter((line) => !cl.includes(line)))
    else return null
    // Ligne d'ancrage : seule la case cochée peut différer ; on garde le côté qui l'a changée.
    if (bi < B.length) out.push(L[li] === B[bi] ? R[ri] : L[li])
    ;[b0, l0, r0] = [bi + 1, li + 1, ri + 1]
  }
  return out.join('\n')
}

export function mergeNotes(base: SharedNote, local: SharedNote, remote: SharedNote): { note: SharedNote; conflict: boolean } {
  const merged: Record<string, unknown> = {}
  let conflict = false
  const b = base as unknown as Record<string, unknown>
  const l = local as unknown as Record<string, unknown>
  const r = remote as unknown as Record<string, unknown>

  for (const key of new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])) {
    let value: unknown
    if (sameValue(l[key], r[key]) || sameValue(r[key], b[key])) value = l[key]
    else if (sameValue(l[key], b[key])) value = r[key]
    else if (key === 'updatedAt') value = Math.max(Number(l[key]) || 0, Number(r[key]) || 0)
    else if (key === 'tags' || key === 'doneDates') value = mergeSets(b[key] as string[], l[key] as string[], r[key] as string[])
    else if (key === 'body') {
      const body = mergeLines(String(b[key] ?? ''), String(l[key] ?? ''), String(r[key] ?? ''))
      conflict ||= body === null
      value = body ?? r[key]
    } else {
      conflict ||= !MINOR_FIELDS.has(key)
      value = r[key]
    }
    if (value !== undefined) merged[key] = value
  }
  return { note: merged as unknown as SharedNote, conflict }
}
