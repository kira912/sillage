import { CHECK_RE } from './checklist'
import { TEXT_COLORS, parseLine, serializeLine, type Marks, type Segment, type TextColor } from './richtext'

/*
 * Passage entre le texte balisé d'une note et le contenu de l'éditeur (contenteditable).
 * Une ligne = un <div> ; une case à cocher = <div data-check=" "|"x">. Les commandes de mise en forme du
 * navigateur produisent <b>, <i>, <u>, <strike> et <font color> : on les relit, comme les styles en ligne.
 */

/** Couleurs passées au navigateur : elles identifient la couleur, l'affichage passe par les tokens (thème sombre). */
export const COLOR_IDS: Record<TextColor, string> = {
  rouge: '#b42d1f',
  orange: '#a14f00',
  vert: '#256d43',
  bleu: '#1d5fa3',
  violet: '#6a45bf',
  rose: '#a8216f',
}
/** « Sans couleur » : retire la couleur d'un passage (y compris à l'intérieur d'un passage coloré). */
export const NO_COLOR_ID = '#000001'

const BLOCKS = new Set(['DIV', 'P', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE'])

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function inlineHtml(line: string): string {
  return parseLine(line)
    .map(({ text, marks }) => {
      let html = escapeHtml(text)
      if (marks.s) html = `<strike>${html}</strike>`
      if (marks.u) html = `<u>${html}</u>`
      if (marks.i) html = `<i>${html}</i>`
      if (marks.b) html = `<b>${html}</b>`
      if (marks.color) html = `<span data-color="${marks.color}">${html}</span>`
      return html
    })
    .join('')
}

/** Texte balisé → HTML de l'éditeur. */
export function toHtml(text: string, multiline: boolean): string {
  if (!multiline) return inlineHtml(text.replace(/\n/g, ' '))
  return text
    .split('\n')
    .map((line) => {
      const m = line.match(CHECK_RE)
      if (!m) return `<div>${inlineHtml(line) || '<br>'}</div>`
      return `<div data-check="${m[2].toLowerCase() === 'x' ? 'x' : ' '}">${inlineHtml(m[3]) || '<br>'}</div>`
    })
    .join('')
}

function colorOf(value: string): TextColor | undefined {
  if ((TEXT_COLORS as readonly string[]).includes(value)) return value as TextColor
  let hex = value.trim().toLowerCase()
  const rgb = hex.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (rgb) hex = `#${rgb.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`
  return TEXT_COLORS.find((c) => COLOR_IDS[c] === hex)
}

/** Mise en forme d'un texte : celle de ses ancêtres, du plus extérieur au plus proche (le plus proche l'emporte). */
export function marksOf(node: Node, root: HTMLElement): Marks {
  const chain: HTMLElement[] = []
  const start = node instanceof HTMLElement ? node : node.parentElement
  for (let el = start; el && el !== root; el = el.parentElement) chain.unshift(el)
  const marks: Marks = {}
  for (const el of chain) {
    const tag = el.tagName
    if (tag === 'B' || tag === 'STRONG') marks.b = true
    if (tag === 'I' || tag === 'EM') marks.i = true
    if (tag === 'U' || tag === 'INS') marks.u = true
    if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') marks.s = true
    const { fontWeight, fontStyle, textDecorationLine, color } = el.style
    if (fontWeight) marks.b = fontWeight === 'bold' || Number(fontWeight) >= 600 || undefined
    if (fontStyle) marks.i = fontStyle === 'italic' || undefined
    if (textDecorationLine) {
      marks.u = textDecorationLine.includes('underline') || undefined
      marks.s = textDecorationLine.includes('line-through') || undefined
    }
    const colorValue = el.dataset.color ?? el.getAttribute('color') ?? color
    if (colorValue) marks.color = colorOf(colorValue)
  }
  return marks
}

/** Un <br> qui ne fait que donner une hauteur à une ligne vide ou terminer un bloc ne crée pas de ligne. */
function isTrailingBr(br: HTMLElement): boolean {
  for (let n = br.nextSibling; n; n = n.nextSibling) {
    if (n.nodeType !== Node.TEXT_NODE || n.textContent) return false
  }
  return true
}

interface Line {
  check?: ' ' | 'x'
  segments: Segment[]
}

/** HTML de l'éditeur → texte balisé. */
export function fromDom(root: HTMLElement, multiline: boolean): string {
  const lines: Line[] = []
  let current: Line | null = null
  const start = (check?: Line['check']) => {
    current = { check, segments: [] }
    lines.push(current)
    return current
  }

  const walk = (node: Node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const parts = (child.textContent ?? '').replace(/ /g, ' ').split('\n')
        parts.forEach((part, k) => {
          const line = k > 0 || !current ? start() : current
          if (part) line.segments.push({ text: part, marks: marksOf(child, root) })
        })
      } else if (child instanceof HTMLElement) {
        if (child.tagName === 'BR') {
          if (!isTrailingBr(child)) start()
        } else if (BLOCKS.has(child.tagName)) {
          const check = child.dataset.check === undefined ? undefined : child.dataset.check === 'x' ? 'x' : ' '
          const line = start(check)
          const count = lines.length
          walk(child)
          // Bloc qui ne contient que d'autres blocs : pas de ligne vide en plus.
          if (!line.segments.length && lines.length > count && line.check === undefined) lines.splice(lines.indexOf(line), 1)
          current = null
        } else {
          walk(child)
        }
      }
    }
  }
  walk(root)

  const text = lines.map((l) => (l.check ? `- [${l.check}] ${serializeLine(l.segments)}` : serializeLine(l.segments)))
  return multiline ? text.join('\n') : text.join(' ')
}
