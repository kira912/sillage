import { CHECK_RE } from './checklist'

/*
 * Mise en forme du titre et du texte des notes, stockée dans le texte lui-même avec un balisage léger :
 * **gras**, *italique*, __souligné__, ~~barré~~, {rouge}en couleur{/}. Le texte reste ligne par ligne (cases à
 * cocher, fusion de la synchronisation, recherche) ; les caractères spéciaux tapés tels quels sont échappés
 * par « \ ». Un délimiteur sans partenaire sur la ligne reste du texte : les anciennes notes s'affichent à l'identique.
 */

export const TEXT_COLORS = ['rouge', 'orange', 'vert', 'bleu', 'violet', 'rose'] as const
export type TextColor = (typeof TEXT_COLORS)[number]

export interface Marks {
  b?: boolean
  i?: boolean
  u?: boolean
  s?: boolean
  color?: TextColor
}

export interface Segment {
  text: string
  marks: Marks
}

type Toggle = 'b' | 'i' | 'u' | 's'
const TOGGLES: [string, Toggle][] = [
  ['**', 'b'],
  ['__', 'u'],
  ['~~', 's'],
  ['*', 'i'],
]
const DELIMITER: Record<Toggle, string> = { b: '**', i: '*', u: '__', s: '~~' }
/** Ordre d'imbrication à l'écriture : la couleur englobe le reste. */
const ORDER: Toggle[] = ['b', 'i', 'u', 's']
const COLOR_RE = new RegExp(`^\\{(${TEXT_COLORS.join('|')})\\}`)
const ESCAPABLE = '\\*_~{'

type Token = { kind: 'text'; text: string } | { kind: 'toggle'; mark: Toggle; raw: string } | { kind: 'open'; color: TextColor; raw: string } | { kind: 'close'; raw: string }

function tokenize(line: string): Token[] {
  const tokens: Token[] = []
  let text = ''
  const flush = () => {
    if (text) tokens.push({ kind: 'text', text })
    text = ''
  }
  for (let i = 0; i < line.length; ) {
    const ch = line[i]
    if (ch === '\\' && i + 1 < line.length && ESCAPABLE.includes(line[i + 1])) {
      text += line[i + 1]
      i += 2
      continue
    }
    const toggle = TOGGLES.find(([d]) => line.startsWith(d, i))
    if (toggle) {
      flush()
      tokens.push({ kind: 'toggle', mark: toggle[1], raw: toggle[0] })
      i += toggle[0].length
      continue
    }
    const color = line.slice(i).match(COLOR_RE)
    if (color) {
      flush()
      tokens.push({ kind: 'open', color: color[1] as TextColor, raw: color[0] })
      i += color[0].length
      continue
    }
    if (line.startsWith('{/}', i)) {
      flush()
      tokens.push({ kind: 'close', raw: '{/}' })
      i += 3
      continue
    }
    text += ch
    i++
  }
  flush()
  return tokens
}

/** Une ligne de texte balisé → morceaux de texte avec leur mise en forme. */
export function parseLine(line: string): Segment[] {
  const tokens = tokenize(line)

  // Un délimiteur n'est actif qu'avec un partenaire : les bascules vont par paires, les couleurs s'ouvrent et se ferment.
  const active = new Set<number>()
  const pending = new Map<Toggle, number>()
  const colors: number[] = []
  tokens.forEach((t, i) => {
    if (t.kind === 'toggle') {
      const open = pending.get(t.mark)
      if (open === undefined) pending.set(t.mark, i)
      else {
        active.add(open).add(i)
        pending.delete(t.mark)
      }
    } else if (t.kind === 'open') colors.push(i)
    else if (t.kind === 'close' && colors.length) active.add(colors.pop()!).add(i)
  })

  const segments: Segment[] = []
  const marks: Marks = {}
  const colorStack: TextColor[] = []
  const push = (text: string) => {
    const last = segments.at(-1)
    if (last && sameMarks(last.marks, marks)) last.text += text
    else segments.push({ text, marks: { ...marks } })
  }
  tokens.forEach((t, i) => {
    if (t.kind === 'text') return push(t.text)
    if (!active.has(i)) return push(t.raw)
    if (t.kind === 'toggle') marks[t.mark] = !marks[t.mark] || undefined
    else if (t.kind === 'open') colorStack.push(t.color)
    else colorStack.pop()
    marks.color = colorStack.at(-1)
  })
  return segments.filter((s) => s.text)
}

const escapeText = (text: string) => text.replace(/[\\*_~{]/g, (c) => `\\${c}`)

export function sameMarks(a: Marks, b: Marks): boolean {
  return !!a.b === !!b.b && !!a.i === !!b.i && !!a.u === !!b.u && !!a.s === !!b.s && a.color === b.color
}

/** Morceaux mis en forme → une ligne de texte balisé (imbrication toujours correcte). */
export function serializeLine(segments: Segment[]): string {
  let out = ''
  let open: string[] = []
  const closeAll = () => {
    for (const d of open.reverse()) out += d === 'color' ? '{/}' : DELIMITER[d as Toggle]
    open = []
  }
  let current: Marks = {}
  for (const seg of segments) {
    if (!seg.text) continue
    if (!sameMarks(seg.marks, current)) {
      closeAll()
      if (seg.marks.color) {
        out += `{${seg.marks.color}}`
        open.push('color')
      }
      for (const m of ORDER) {
        if (!seg.marks[m]) continue
        out += DELIMITER[m]
        open.push(m)
      }
      current = seg.marks
    }
    out += escapeText(seg.text)
  }
  closeAll()
  return out
}

/** Texte sans balisage : recherche, notifications, export vers le Calendrier, envoi à l'IA. */
export function plainText(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const m = line.match(CHECK_RE)
      const content = m ? m[3] : line
      const plain = parseLine(content).map((s) => s.text).join('')
      return m ? `${m[1]}- [${m[2]}] ${plain}` : plain
    })
    .join('\n')
}

/** Vrai si le texte contient de la mise en forme. */
export const hasMarkup = (text: string) => text !== plainText(text)
