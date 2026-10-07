import { CHECK_RE } from './checklist'
import { db, newNote } from './db'
import { getSpace } from './space'
import type { Note } from './types'

/**
 * Liste de courses : une note unique, d'identifiant fixe, dont chaque article est une case à cocher
 * (« - [ ] 2 lait »). L'identifiant fixe fait qu'elle reste la même liste sur tous les téléphones de l'espace,
 * et le format en cases à cocher garde la fusion ligne par ligne de la synchronisation.
 * Sa date (et son heure, son rappel) en font la tâche « Faire les courses ».
 */
export const SHOPPING_ID = 'courses'

export const isShoppingList = (n: Pick<Note, 'id'>) => n.id === SHOPPING_ID

export interface Item {
  /** Index de la ligne dans le texte de la note. */
  line: number
  checked: boolean
  qty?: number
  unit?: string
  name: string
}

const UNITS = ['kg', 'g', 'l', 'cl', 'ml']
const QTY_RE = new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*(${UNITS.join('|')})?\\s+(.+)$`, 'i')
const QTY_AFTER_RE = /^(.+?)\s*[x×]\s*(\d+)$/i

/** « 2 lait », « 500 g farine », « lait x2 », « lait » → quantité, unité, nom. */
export function parseItem(text: string): Omit<Item, 'line' | 'checked'> | null {
  const t = text.trim().replace(/\s+/g, ' ')
  if (!t) return null
  const m = t.match(QTY_RE)
  if (m) return { qty: Number(m[1].replace(',', '.')), unit: m[2]?.toLowerCase(), name: m[3] }
  const a = t.match(QTY_AFTER_RE)
  if (a) return { qty: Number(a[2]), name: a[1] }
  return { name: t }
}

const formatQty = (qty: number) => String(Math.round(qty * 100) / 100).replace('.', ',')

/** Quantité affichée à côté du nom : « ×2 », « 500 g ». */
export function describeQty(item: Pick<Item, 'qty' | 'unit'>): string {
  if (item.qty === undefined) return ''
  return item.unit ? `${formatQty(item.qty)} ${item.unit}` : `×${formatQty(item.qty)}`
}

function itemText(item: Omit<Item, 'line' | 'checked'>): string {
  if (item.qty === undefined) return item.name
  return item.unit ? `${formatQty(item.qty)} ${item.unit} ${item.name}` : `${formatQty(item.qty)} ${item.name}`
}

const itemLine = (item: Omit<Item, 'line'>) => `- [${item.checked ? 'x' : ' '}] ${itemText(item)}`

export function parseItems(body: string): Item[] {
  return body.split('\n').flatMap((line, i) => {
    const m = line.match(CHECK_RE)
    const parsed = m && parseItem(m[3])
    return parsed ? [{ ...parsed, line: i, checked: m[2].toLowerCase() === 'x' }] : []
  })
}

/** Clé de comparaison : sans casse, accents, ni pluriel (« Tomates » = « tomate »). */
export function itemKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 ? w.replace(/[sx]$/, '') : w))
    .join(' ')
}

/** Découpe une saisie en articles : « lait, 2 baguettes ; œufs ». */
export const splitInput = (text: string) => text.split(/[,;\n]+/).flatMap((s) => parseItem(s) ?? [])

/**
 * Ajoute des articles au texte de la liste. Un article déjà présent n'est pas dupliqué : les quantités
 * s'additionnent (« lait » + « lait » = 2 lait), et un article déjà coché redevient à acheter.
 */
export function addItems(body: string, added: Omit<Item, 'line' | 'checked'>[]): string {
  const lines = body ? body.split('\n') : []
  for (const add of added) {
    const existing = parseItems(lines.join('\n')).find((i) => itemKey(i.name) === itemKey(add.name) && i.unit === add.unit)
    if (!existing) {
      lines.push(itemLine({ ...add, checked: false }))
      continue
    }
    const qty = existing.checked ? add.qty : (existing.qty ?? 1) + (add.qty ?? 1)
    lines[existing.line] = itemLine({ name: existing.name, unit: add.unit, qty, checked: false })
  }
  return lines.join('\n')
}

export function setItemQty(body: string, item: Item, qty: number | undefined): string {
  const lines = body.split('\n')
  lines[item.line] = itemLine({ ...item, qty: qty !== undefined && qty > 0 ? qty : undefined })
  return lines.join('\n')
}

export function removeLine(body: string, line: number): string {
  return body
    .split('\n')
    .filter((_, i) => i !== line)
    .join('\n')
}

/**
 * Fusion de deux listes qui ne se connaissaient pas (ex. une liste faite avant de rejoindre l'espace et celle
 * de l'espace) : on garde tous les articles, sans doublon.
 */
export function mergeLists(local: string, remote: string): string {
  const fromLocal = parseItems(local).filter((i) => !i.checked)
  const remoteKeys = new Set(parseItems(remote).map((i) => itemKey(i.name)))
  const missing = fromLocal.filter((i) => !remoteKeys.has(itemKey(i.name)))
  return missing.length ? [remote, ...missing.map(itemLine)].filter(Boolean).join('\n') : remote
}

/* ------------------------------------------------------------------------------------------------
 * La note
 * ---------------------------------------------------------------------------------------------- */

/** Crée la liste si besoin (ou la sort de la corbeille), partagée dès qu'il y a un espace. */
async function ensureList(): Promise<Note> {
  const existing = await db.notes.get(SHOPPING_ID)
  const shared = getSpace() ? true : undefined
  if (existing && !existing.deletedAt && (existing.shared || !shared)) return existing
  const note: Note = existing
    ? { ...existing, deletedAt: undefined, shared: existing.shared ?? shared }
    : newNote({ id: SHOPPING_ID, title: 'Courses', tags: ['courses'], shared })
  await db.notes.put(note)
  return note
}

/** Modifie la liste (créée si besoin). */
export async function updateList(change: (note: Note) => Partial<Note>) {
  await db.transaction('rw', db.notes, async () => {
    const note = await ensureList()
    await db.notes.update(SHOPPING_ID, { ...change(note), updatedAt: Date.now() })
  })
}

export const addToList = (text: string) => {
  const items = splitInput(text)
  if (items.length) recordAdded(items.map((i) => i.name))
  return updateList((n) => ({ body: addItems(n.body, items) }))
}

/** Après les courses : retire les articles achetés et termine la tâche (date, heure et rappel effacés). */
export async function finishShopping() {
  await updateList((n) => ({
    body: n.body
      .split('\n')
      .filter((l) => !/^\s*- \[x\]/i.test(l))
      .join('\n'),
    date: undefined,
    time: undefined,
    reminder: undefined,
    doneDates: [],
  }))
}

/* ------------------------------------------------------------------------------------------------
 * Rayons : classement par mots-clés, dans l'ordre d'un parcours de supermarché
 * ---------------------------------------------------------------------------------------------- */

export const AISLES: { name: string; words: string[] }[] = [
  {
    name: 'Fruits et légumes',
    words: [
      'fruit', 'legume', 'pomme', 'poire', 'banane', 'orange', 'citron', 'clementine', 'mandarine', 'fraise', 'framboise',
      'myrtille', 'raisin', 'kiwi', 'ananas', 'mangue', 'peche', 'abricot', 'prune', 'cerise', 'melon', 'pasteque',
      'avocat', 'tomate', 'salade', 'laitue', 'mache', 'roquette', 'epinard', 'carotte', 'courgette', 'aubergine',
      'poivron', 'concombre', 'oignon', 'echalote', 'ail', 'pomme de terre', 'patate', 'haricot vert', 'brocoli',
      'chou', 'chou-fleur', 'poireau', 'celeri', 'radi', 'champignon', 'navet', 'betterave', 'potiron', 'courge',
      'butternut', 'persil', 'basilic', 'coriandre', 'ciboulette', 'menthe', 'herbe', 'gingembre', 'endive', 'fenouil',
      'artichaut', 'asperge', 'petit poi',
    ],
  },
  { name: 'Boulangerie', words: ['pain', 'baguette', 'brioche', 'croissant', 'viennoiserie', 'pain de mie', 'biscotte', 'tortilla', 'wrap'] },
  {
    name: 'Boucherie et poisson',
    words: [
      'viande', 'boeuf', 'steak', 'hache', 'poulet', 'dinde', 'porc', 'veau', 'agneau', 'canard', 'saucisse', 'merguez',
      'jambon', 'lardon', 'bacon', 'chorizo', 'saucisson', 'charcuterie', 'roti', 'escalope', 'cote', 'filet', 'poisson',
      'saumon', 'cabillaud', 'colin', 'thon frai', 'crevette', 'moule', 'surimi', 'blanc de poulet',
    ],
  },
  {
    name: 'Crèmerie',
    words: [
      'lait', 'beurre', 'creme', 'creme fraiche', 'yaourt', 'yogourt', 'fromage', 'emmental', 'gruyere', 'comte',
      'mozzarella', 'parmesan', 'chevre', 'camembert', 'brie', 'feta', 'ricotta', 'mascarpone', 'oeuf', 'skyr',
      'fromage blanc', 'petit suisse', 'compote', 'pate feuilletee', 'pate brisee', 'pate a pizza', 'dessert',
    ],
  },
  { name: 'Surgelés', words: ['surgele', 'glace', 'frite', 'congele', 'pizza surgelee', 'poisson pane', 'sorbet'] },
  {
    name: 'Épicerie salée',
    words: [
      'pate', 'spaghetti', 'penne', 'tagliatelle', 'riz', 'semoule', 'quinoa', 'lentille', 'pois chiche', 'farine',
      'huile', 'vinaigre', 'sel', 'poivre', 'epice', 'moutarde', 'mayonnaise', 'ketchup', 'sauce', 'bouillon', 'conserve',
      'thon', 'sardine', 'mai', 'olive', 'cornichon', 'soupe', 'chip', 'cracker', 'aperitif', 'coulis', 'concentre',
    ],
  },
  {
    name: 'Épicerie sucrée',
    words: [
      'sucre', 'chocolat', 'cafe', 'the', 'tisane', 'cereale', 'muesli', 'flocon', 'avoine', 'confiture', 'miel',
      'nutella', 'pate a tartiner', 'biscuit', 'gateau', 'bonbon', 'levure', 'vanille', 'cacao', 'sirop', 'madeleine',
      'compote', 'fruit sec', 'amande', 'noisette', 'noix',
    ],
  },
  {
    name: 'Boissons',
    words: ['eau', 'jus', 'soda', 'coca', 'limonade', 'biere', 'vin', 'champagne', 'cidre', 'boisson', 'sirop', 'lait vegetal'],
  },
  {
    name: 'Hygiène et beauté',
    words: [
      'shampoing', 'shampooing', 'gel douche', 'savon', 'dentifrice', 'brosse a dent', 'deodorant', 'coton', 'rasoir',
      'creme hydratante', 'mouchoir', 'papier toilette', 'pq', 'serviette hygienique', 'tampon', 'protege', 'maquillage',
      'demaquillant', 'apres shampoing',
    ],
  },
  {
    name: 'Entretien',
    words: [
      'lessive', 'adoucissant', 'liquide vaisselle', 'pastille lave', 'tablette lave', 'eponge', 'essuie tout',
      'sac poubelle', 'javel', 'nettoyant', 'detergent', 'sopalin', 'papier alu', 'aluminium', 'film etirable',
      'papier cuisson', 'ampoule', 'pile',
    ],
  },
  { name: 'Bébé', words: ['couche', 'lingette', 'lait infantile', 'petit pot', 'biberon', 'bebe'] },
  { name: 'Animaux', words: ['croquette', 'litiere', 'patee', 'chat', 'chien'] },
]

export const OTHER_AISLE = 'Autres'

/**
 * Rayon d'un article : le mot-clé le plus long trouvé en début de mot gagne (« lait de coco » ira avec
 * « lait » faute de mieux, mais « liquide vaisselle » ne sera pas pris pour du « lait »).
 */
export function aisleOf(name: string): string {
  const key = ` ${itemKey(name)} `
  let best: { aisle: string; len: number } | null = null
  for (const aisle of AISLES) {
    for (const word of aisle.words) {
      const w = itemKey(word)
      if (key.includes(` ${w}`) && (!best || w.length > best.len)) best = { aisle: aisle.name, len: w.length }
    }
  }
  return best?.aisle ?? OTHER_AISLE
}

const AISLE_ORDER = [...AISLES.map((a) => a.name), OTHER_AISLE]

/** Articles à acheter regroupés par rayon, dans l'ordre du magasin. */
export function groupByAisle(items: Item[]): { aisle: string; items: Item[] }[] {
  const groups = new Map<string, Item[]>()
  for (const item of items) {
    const aisle = aisleOf(item.name)
    groups.set(aisle, [...(groups.get(aisle) ?? []), item])
  }
  return AISLE_ORDER.filter((a) => groups.has(a)).map((aisle) => ({ aisle, items: groups.get(aisle)! }))
}

/* ------------------------------------------------------------------------------------------------
 * Suggestions : articles ajoutés souvent (historique propre à ce téléphone)
 * ---------------------------------------------------------------------------------------------- */

const HISTORY_KEY = 'sillage:shopping-history'
const MAX_HISTORY = 200

interface HistoryEntry {
  name: string
  count: number
  last: number
}

function readHistory(): Record<string, HistoryEntry> {
  try {
    const data = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '{}')
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}

function recordAdded(names: string[]) {
  const history = readHistory()
  const now = Date.now()
  for (const name of names) {
    const key = itemKey(name)
    if (!key) continue
    history[key] = { name, count: (history[key]?.count ?? 0) + 1, last: now }
  }
  const kept = Object.entries(history)
    .sort(([, a], [, b]) => b.last - a.last)
    .slice(0, MAX_HISTORY)
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(Object.fromEntries(kept)))
  } catch {
    /* stockage indisponible : pas de suggestions, sans gravité */
  }
}

/**
 * Articles à proposer : les plus souvent ajoutés (les récents comptent davantage), absents de la liste.
 * Avec une saisie en cours, seulement ceux qui commencent pareil.
 */
export function suggestions(current: Item[], typed: string, limit = 8): string[] {
  const inList = new Set(current.filter((i) => !i.checked).map((i) => itemKey(i.name)))
  const prefix = itemKey(typed.split(/[,;]/).pop() ?? '')
  const now = Date.now()
  return Object.entries(readHistory())
    .filter(([key]) => !inList.has(key) && (!prefix || key.startsWith(prefix)) && key !== prefix)
    .map(([, e]) => ({ name: e.name, score: e.count / (1 + (now - e.last) / (30 * 86_400_000)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((e) => e.name)
}
