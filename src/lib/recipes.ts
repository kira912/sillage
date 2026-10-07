import { api } from './api'
import { db, newNote } from './db'
import { itemKey } from './shopping'
import { shouldAutoShare } from './space'

/** Recette proposée par l'IA à partir de la liste de courses (voir `api/recipes.ts`). */
export interface Recipe {
  title: string
  minutes: number
  uses: string[]
  missing: string[]
  steps: string[]
}

interface Saved {
  /** Articles de la liste au moment de la demande, pour savoir si elle a changé depuis. */
  listKey: string
  wish: string
  recipes: Recipe[]
}

const KEY = 'sillage:recipe-ideas'
const WISH_KEY = 'sillage:recipe-wish'

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
export const clearIdeas = () => write(KEY, null)

/** Dernière envie saisie, reproposée la fois suivante. */
export const savedWish = () => read<string>(WISH_KEY) ?? ''

export async function fetchIdeas(items: string[], wish: string, signal?: AbortSignal): Promise<Saved> {
  const { recipes } = await api<{ recipes: Recipe[] }>('recipes', { body: { items, wish }, timeoutMs: 90_000, signal })
  const saved = { listKey: listKeyOf(items), wish, recipes }
  write(KEY, saved)
  write(WISH_KEY, wish)
  return saved
}

/** Enregistre une recette comme note : ingrédients en cases à cocher, puis les étapes. */
export async function keepRecipe(recipe: Recipe) {
  const tags = ['recette']
  const body = [
    recipe.minutes ? `${recipe.minutes} min · 4 personnes` : '4 personnes',
    '',
    'Ingrédients',
    ...[...recipe.uses, ...recipe.missing].map((i) => `- [ ] ${i}`),
    '',
    'Étapes',
    ...recipe.steps.map((s, i) => `${i + 1}. ${s}`),
  ].join('\n')
  await db.notes.add(newNote({ title: recipe.title, body, tags, shared: shouldAutoShare(tags) || undefined }))
}
