import Anthropic from '@anthropic-ai/sdk'
import { checkAccess, error, json, readJson } from './_lib/http.js'
import { NOTES_SCHEMA, sanitizeNotes } from './_lib/notes.js'

const MODEL = process.env.SILLAGE_MODEL || 'claude-opus-5-5'
const MAX_INPUT = 2000

const SYSTEM_PROMPT = `You turn short French notes, typed or dictated on a phone, into structured entries for a personal notes and agenda app. Reply with JSON matching the schema; all text you write must be in French.

How to fill the fields:
- One entry per distinct thing to remember. "Anniversaire de Paul samedi et piscine dimanche" is two entries; a shopping list is one entry.
- title: short and natural ("Pédiatre Léa", "Sortir les poubelles"), first letter capitalised, no date or time in it.
- body: only extra details the user gave. Turn enumerations of things to buy or to do into checklist lines, one per line, written "- [ ] item". Use "" when there is nothing to add.
- date: resolve relative expressions ("demain", "jeudi prochain", "dans 3 jours", "le 12") against the current date given in the request, as YYYY-MM-DD. A bare weekday means its next occurrence (today counts if it is that weekday and no time has passed). Use "" when nothing is dated.
- time: 24-hour HH:mm, only when stated or clearly implied. Map vague moments: matin 09:00, midi 12:00, après-midi 15:00, soir 19:00. Otherwise "".
- recurrence: freq "none" unless the user describes a repetition ("tous les mardis", "chaque mois", "un jeudi sur deux" = weekly with interval 2). For a recurring entry, date is the first occurrence. weekdays uses 0 = Sunday … 6 = Saturday and only matters for weekly; use [] otherwise. until is an end date or "".
- reminder_minutes: -1 unless the user asks to be reminded ("rappelle-moi", "n'oublie pas de me prévenir"). Then use the delay they give (10, 30, 60, 120 or 1440 for "la veille"), defaulting to 60 when the entry has a time and 0 when it does not.
- tags: 0 to 2 short lowercase words without "#". Prefer the user's existing tags when one fits.`

interface ParseRequest {
  text?: unknown
  today?: unknown
  timezone?: unknown
  tags?: unknown
}

// Instancié à la demande : sans clé, la route répond 503 au lieu de planter au chargement.
let client: Anthropic | undefined

export async function POST(request: Request) {
  const denied = checkAccess(request)
  if (denied) return denied
  if (!process.env.ANTHROPIC_API_KEY) return error(503, 'Saisie IA non configurée (ANTHROPIC_API_KEY manquante)')

  const input = await readJson<ParseRequest>(request)
  const text = typeof input?.text === 'string' ? input.text.trim() : ''
  const today = typeof input?.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.today) ? input.today : null
  if (!text || !today) return error(400, 'Texte ou date manquant')
  if (text.length > MAX_INPUT) return error(413, `Texte trop long (${MAX_INPUT} caractères max)`)

  const timezone = typeof input?.timezone === 'string' ? input.timezone.slice(0, 64) : 'Europe/Paris'
  const tags = Array.isArray(input?.tags)
    ? input.tags.filter((t): t is string => typeof t === 'string').slice(0, 50).map((t) => t.slice(0, 40))
    : []
  const weekday = new Date(`${today}T12:00:00Z`).toLocaleDateString('fr-FR', { weekday: 'long', timeZone: 'UTC' })

  try {
    client ??= new Anthropic()
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: NOTES_SCHEMA } },
      // Si un filtre de sécurité refuse la requête, l'API la relance sur le modèle de repli recommandé.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages: [
        {
          role: 'user',
          content: [
            `Current date: ${today} (${weekday}), timezone ${timezone}.`,
            `Existing tags: ${tags.length ? tags.join(', ') : '(none)'}.`,
            '',
            '<note>',
            text,
            '</note>',
          ].join('\n'),
        },
      ],
    })

    if (response.stop_reason === 'refusal') return error(422, 'Cette demande n’a pas pu être traitée.')
    if (response.stop_reason === 'max_tokens') return error(422, 'Texte trop long à analyser.')

    const textBlock = response.content.find((b) => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') return error(502, 'Réponse vide du modèle')

    const notes = sanitizeNotes(JSON.parse(textBlock.text))
    return json({ notes })
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return error(429, 'Trop de demandes, réessayez dans un instant.')
    if (e instanceof Anthropic.AuthenticationError) return error(503, 'Clé API Anthropic invalide côté serveur.')
    if (e instanceof Anthropic.APIError) return error(502, `Erreur du service IA (${e.status ?? '?'})`)
    if (e instanceof SyntaxError) return error(502, 'Réponse illisible du modèle')
    console.error('[sillage] parse', e)
    return error(500, 'Erreur interne')
  }
}
