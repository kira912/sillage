import { api } from './api'
import { db, newNote } from './db'
import { toKey } from './dates'
import { plainText } from './richtext'
import { describeQty, itemKey, type Item } from './shopping'
import { shouldAutoShare } from './space'

/** Recette proposée par l'IA à partir de la liste de courses (voir `api/recipes.ts`). */
export interface Ingredient {
  name: string
  quantity: string
  /** Dans la liste de courses, dans le placard (basiques), ou à acheter en plus. */
  source: 'list' | 'pantry' | 'missing'
}

export interface Recipe {
  title: string
  pitch: string
  minutes: number
  ingredients: Ingredient[]
  steps: string[]
}

interface Saved {
  /** Articles de la liste au moment de la demande, pour savoir si elle a changé depuis. */
  listKey: string
  wish: string
  recipes: Recipe[]
}

// Clé versionnée : les idées enregistrées avant le changement de format sont ignorées.
const KEY = 'sillage:recipe-ideas-v2'
const WISH_KEY = 'sillage:recipe-wish'
const MAX_MISSING = 3
/** Recettes gardées envoyées à l'IA pour qu'elle ne les repropose pas. */
const MAX_KEPT_SENT = 25

export const listKeyOf = (names: string[]) => [...new Set(names.map(itemKey))].sort().join('|')

function read<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null')
  } catch {
    return null
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* stockage indisponible : les idées ne survivront pas à la fermeture de l'app */
  }
}

/** Dernières idées, gardées jusqu'à la prochaine demande (pas d'appel à l'IA en revenant sur l'onglet). */
export const savedIdeas = () => read<Saved>(KEY)

/** Dernière envie saisie, reproposée la fois suivante. */
export const savedWish = () => read<string>(WISH_KEY) ?? ''

const words = (key: string) => ` ${key} `

/**
 * L'ingrédient est-il dans la liste ? Même comparaison que la fusion des doublons (casse, accents, pluriel),
 * et un nom plus général que l'article compte aussi (« crème » pour « crème fraîche »).
 */
export function onList(name: string, listKeys: string[]): boolean {
  const key = itemKey(name)
  return !!key && listKeys.some((k) => k === key || words(k).includes(words(key)))
}

/**
 * Corrige la classification de l'IA d'après la vraie liste : un ingrédient « à acheter » déjà dans la liste
 * y est rattaché, et un ingrédient « de la liste » introuvable devient à acheter. Les recettes auxquelles il
 * manque alors trop d'ingrédients sont écartées.
 */
export function reconcile(recipes: Recipe[], listNames: string[]): Recipe[] {
  const keys = listNames.map(itemKey)
  return recipes
    .map((r) => ({
      ...r,
      ingredients: r.ingredients.map((i): Ingredient => {
        if (i.source === 'missing' && onList(i.name, keys)) return { ...i, source: 'list' }
        // Nom plus précis que l'article (« tomates cerises » pour « tomates ») : on fait confiance à l'IA.
        const refined = keys.some((k) => words(itemKey(i.name)).includes(words(k)))
        if (i.source === 'list' && !onList(i.name, keys) && !refined) return { ...i, source: 'missing' }
        return i
      }),
    }))
    .filter((r) => r.ingredients.filter((i) => i.source === 'missing').length <= MAX_MISSING)
}

/** Article tel qu'envoyé à l'IA, avec sa quantité : « œufs (×6) », « farine (500 g) ». */
const describeItem = (item: Item) => (item.qty !== undefined ? `${item.name} (${describeQty(item)})` : item.name)

export async function fetchIdeas(items: Item[], wish: string, signal?: AbortSignal): Promise<Saved> {
  const names = items.map((i) => i.name)
  // Idées déjà proposées et recettes gardées : l'IA doit en trouver de nouvelles.
  const kept = await db.notes
    .where('tags')
    .equals('recette')
    .filter((n) => !n.deletedAt)
    .toArray()
  const avoid = [
    ...new Set([
      ...(savedIdeas()?.recipes.map((r) => r.title) ?? []),
      ...kept
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, MAX_KEPT_SENT)
        .map((n) => plainText(n.title)),
    ]),
  ].filter(Boolean)

  const { recipes } = await api<{ recipes: Recipe[] }>('recipes', {
    body: { items: items.map(describeItem), wish, today: toKey(new Date()), avoid },
    timeoutMs: 90_000,
    signal,
  })
  const saved = { listKey: listKeyOf(names), wish, recipes: reconcile(recipes, names) }
  write(KEY, saved)
  write(WISH_KEY, wish)
  return saved
}

const ingredientLine = (i: Ingredient) => (i.quantity ? `${i.quantity} ${i.name}` : i.name)

/** Enregistre une recette comme note : ingrédients (avec quantités) en cases à cocher, puis les étapes. */
export async function keepRecipe(recipe: Recipe) {
  const tags = ['recette']
  const body = [
    [recipe.minutes ? `${recipe.minutes} min` : '', '4 personnes'].filter(Boolean).join(' · '),
    ...(recipe.pitch ? [recipe.pitch] : []),
    '',
    'Ingrédients',
    ...recipe.ingredients.map((i) => `- [ ] ${ingredientLine(i)}`),
    '',
    'Étapes',
    ...recipe.steps.map((s, i) => `${i + 1}. ${s}`),
  ].join('\n')
  await db.notes.add(newNote({ title: recipe.title, body, tags, shared: shouldAutoShare(tags) || undefined }))
}
