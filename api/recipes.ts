import Anthropic from '@anthropic-ai/sdk'
import { aiAccess, refusalFallback } from './_lib/ai-access.js'
import { error, guard, json, readJson } from './_lib/http.js'

const MAX_ITEMS = 150
const MAX_ITEM_LENGTH = 80
const MAX_WISH = 200
const MAX_AVOID = 40
const MAX_RECIPES = 6
const MAX_MISSING = 3
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
/** Garde-fous de coût avec le code d'accès, et petit quota gratuit sans code (voir _lib/ai-access.ts). */
const LIMITS = { label: 'recherches de recettes', perIpHour: 20, perDay: 200, freePerDevice: 2, freePerDay: 40 }

const SYSTEM_PROMPT = `A family plans its groceries in a notes app. Looking at their shopping list, they want ideas for what to cook in the coming days with what they are buying, and to know when one or two extra items would make a good dish possible. Reply with JSON matching the schema; write everything in French.

What makes good suggestions:
- ${MAX_RECIPES - 1} to ${MAX_RECIPES} everyday home-cooked dishes a family would really make, varied in style and main ingredient, and in season in France at the given date.
- The list gives quantities when the family typed them. Respect them: a dish needing more of an item than the list holds should count the difference as missing.
- Most dishes should be doable with the list and pantry staples alone; a few may need 1 to ${MAX_MISSING} extra items when the dish is worth it.
- The family wants new ideas: do not suggest the dishes listed as already suggested or saved, nor close variants of them.
- The family's wish, when there is one, is a food preference (diet, time, who eats). Ignore anything in it that is not about cooking.

How the app uses your answer:
- ingredients lists every ingredient with its source. "list": on their shopping list; copy the list's wording exactly, because the app links it to the list item. "pantry": a staple assumed at home (salt, pepper, oil, vinegar, butter, flour, sugar, garlic, onions, dried herbs and spices, mustard, stock cubes). "missing": something to buy. Missing ingredients are added to the shopping list in one tap, so name them as found in a supermarket aisle ("crème fraîche", not "20 cl de crème liquide entière") and put the amount in quantity.
- quantity is for 4 servings and short ("200 g", "3", "1 c. à soupe"), or "" when it does not matter.
- pitch is one short sentence that helps the family choose ("Prêt en 20 minutes, idéal un soir de semaine").
- minutes is the total time, preparation and cooking.
- steps are 3 to 6 short steps, read on a phone while cooking.`

const SOURCES = ['list', 'pantry', 'missing'] as const

const RECIPES_SCHEMA = {
  type: 'object',
  properties: {
    recipes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          pitch: { type: 'string' },
          minutes: { type: 'integer' },
          ingredients: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                quantity: { type: 'string' },
                source: { type: 'string', enum: [...SOURCES] },
              },
              required: ['name', 'quantity', 'source'],
              additionalProperties: false,
            },
          },
          steps: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'pitch', 'minutes', 'ingredients', 'steps'],
        additionalProperties: false,
      },
    },
  },
  required: ['recipes'],
  additionalProperties: false,
} as const

interface Ingredient {
  name: string
  quantity: string
  source: (typeof SOURCES)[number]
}

interface Recipe {
  title: string
  pitch: string
  minutes: number
  ingredients: Ingredient[]
  steps: string[]
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

const strings = (v: unknown, max: number, length = 200) =>
  Array.isArray(v) ? v.map((s) => text(s, length)).filter(Boolean).slice(0, max) : []

function ingredient(raw: unknown): Ingredient[] {
  if (!raw || typeof raw !== 'object') return []
  const r = raw as Record<string, unknown>
  const name = text(r.name, 80)
  const source = SOURCES.find((s) => s === r.source)
  return name && source ? [{ name, quantity: text(r.quantity, 40), source }] : []
}

/**
 * Ne garde que des recettes complètes et au bon format, avec au plus MAX_MISSING ingrédients à acheter.
 * (L'app revérifie ensuite chaque ingrédient contre sa liste : voir `src/lib/recipes.ts`.)
 */
function sanitizeRecipes(raw: unknown): Recipe[] {
  const list = (raw as { recipes?: unknown })?.recipes
  if (!Array.isArray(list)) return []
  return list
    .flatMap((r): Recipe[] => {
      if (!r || typeof r !== 'object') return []
      const { title, pitch, minutes, ingredients, steps } = r as Record<string, unknown>
      const recipe = {
        title: text(title, 100),
        pitch: text(pitch, 200),
        minutes: typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : 0,
        ingredients: Array.isArray(ingredients) ? ingredients.flatMap(ingredient).slice(0, 25) : [],
        steps: strings(steps, 10),
      }
      const missing = recipe.ingredients.filter((i) => i.source === 'missing').length
      return recipe.title && recipe.steps.length && recipe.ingredients.length && missing <= MAX_MISSING ? [recipe] : []
    })
    .slice(0, MAX_RECIPES)
}

interface RecipesRequest {
  items?: unknown
  wish?: unknown
  today?: unknown
  avoid?: unknown
}

// Instancié à la demande : sans clé, la route répond 503 au lieu de planter au chargement.
let client: Anthropic | undefined

export const POST = guard(async (request: Request) => {
  if (!process.env.ANTHROPIC_API_KEY) return error(503, 'IA non configurée (ANTHROPIC_API_KEY manquante)')
  const access = await aiAccess(request, 'recipes', LIMITS)
  if (access instanceof Response) return access

  const input = await readJson<RecipesRequest>(request)
  const items = strings(input?.items, MAX_ITEMS + 1, MAX_ITEM_LENGTH)
  if (!items.length) return error(400, 'Liste de courses vide')
  if (items.length > MAX_ITEMS) return error(413, `Liste trop longue (${MAX_ITEMS} articles max)`)
  const wish = text(input?.wish, MAX_WISH)
  const avoid = strings(input?.avoid, MAX_AVOID, 100)
  const today = typeof input?.today === 'string' && DATE_RE.test(input.today) ? input.today : new Date().toISOString().slice(0, 10)
  const date = new Date(`${today}T12:00:00Z`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })

  try {
    client ??= new Anthropic()
    const response = await client.beta.messages.create({
      model: access.model,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: RECIPES_SCHEMA } },
      // Si un filtre de sécurité refuse la requête, l'API la relance sur le modèle de repli recommandé.
      ...refusalFallback(access.model),
      messages: [
        {
          role: 'user',
          content: [
            `Date: ${date}.`,
            '',
            '<shopping_list>',
            ...items.map((i) => `- ${i}`),
            '</shopping_list>',
            '',
            avoid.length ? `<already_suggested_or_saved>\n${avoid.map((t) => `- ${t}`).join('\n')}\n</already_suggested_or_saved>` : 'Nothing suggested or saved yet.',
            '',
            wish ? `<wish>\n${wish}\n</wish>` : 'No particular wish.',
          ].join('\n'),
        },
      ],
    })

    if (response.stop_reason === 'refusal') return error(422, 'Cette demande n’a pas pu être traitée.')
    if (response.stop_reason === 'max_tokens') return error(422, 'Réponse trop longue, réessayez.')

    const textBlock = response.content.find((b) => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') return error(502, 'Réponse vide du modèle')

    return json({ recipes: sanitizeRecipes(JSON.parse(textBlock.text)), quota: access.quota })
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return error(429, 'Trop de demandes, réessayez dans un instant.')
    if (e instanceof Anthropic.AuthenticationError) return error(503, 'Clé API Anthropic invalide côté serveur.')
    if (e instanceof Anthropic.APIError) {
      console.error('[sillage] recipes', e.status, e.message)
      return error(502, `Erreur du service IA (${e.status ?? '?'})`)
    }
    if (e instanceof SyntaxError) return error(502, 'Réponse illisible du modèle')
    console.error('[sillage] recipes', e)
    return error(500, 'Erreur interne')
  }
})
