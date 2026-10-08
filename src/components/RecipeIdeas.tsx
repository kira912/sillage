import { BookmarkPlus, Check, ChefHat, ChevronDown, ChevronUp, Clock, Plus, RefreshCw, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ApiError, type Quota } from '../lib/api'
import { fetchIdeas, keepRecipe, listKeyOf, onList, savedIdeas, savedWish, type Ingredient, type Recipe } from '../lib/recipes'
import { addToList, itemKey, type Item } from '../lib/shopping'
import { useToast } from './Toast'

/**
 * Idées de recettes à partir des articles à acheter : faisables avec la liste, ou presque (1 à 3 ingrédients
 * manquants, ajoutables en un toucher). L'IA n'est appelée que sur demande.
 */
export function RecipeIdeas({ items, onOpenSettings }: { items: Item[]; onOpenSettings: () => void }) {
  const [ideas, setIdeas] = useState(savedIdeas)
  const [wish, setWish] = useState(savedWish)
  const [loading, setLoading] = useState(false)
  const [quota, setQuota] = useState<Quota | null>(null)
  const [outOfQuota, setOutOfQuota] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])

  const names = items.map((i) => i.name)
  const listKeys = names.map(itemKey)
  // Les ingrédients ajoutés depuis une recette proposée ne rendent pas les idées obsolètes.
  const suggested = new Set(ideas?.recipes.flatMap((r) => missingOf(r).map((i) => itemKey(i.name))))
  const changed = !!ideas && ideas.listKey !== listKeyOf(names.filter((n) => !suggested.has(itemKey(n))))

  async function search() {
    setLoading(true)
    setErrorMsg('')
    setOutOfQuota(false)
    request.current = new AbortController()
    try {
      const result = await fetchIdeas(items, wish.trim(), request.current.signal)
      setIdeas(result.ideas)
      setQuota(result.quota ?? null)
    } catch (e) {
      if (request.current?.signal.aborted) return
      setOutOfQuota(e instanceof ApiError && e.status === 429)
      setErrorMsg(e instanceof ApiError && e.status === 401 ? 'Code d’accès invalide : vérifiez-le dans les réglages.' : (e as Error).message)
    } finally {
      setLoading(false)
    }
  }


  // Une recette dont les ingrédients manquants ont tous été ajoutés à la liste devient faisable.
  const stillMissing = (r: Recipe) => missingOf(r).filter((i) => !onList(i.name, listKeys))
  const ready = ideas?.recipes.filter((r) => missingOf(r).length === 0) ?? []
  const almost = ideas?.recipes.filter((r) => missingOf(r).length > 0) ?? []

  return (
    <div className="section">
      <h2 className="section__title">Idées de recettes</h2>
      <div className="group">
        <div className="row-block form">
          <label className="form__field">
            Envie ou contrainte (facultatif)
            <input
              className="field"
              value={wish}
              maxLength={200}
              placeholder="Végétarien, rapide, pour les enfants…"
              enterKeyHint="search"
              onChange={(e) => setWish(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !loading && void search()}
            />
          </label>
          {errorMsg && <p className="capture__error">{errorMsg}</p>}
          <button className="btn btn--primary btn--block" disabled={loading} onClick={search}>
            {loading ? <span className="spinner" /> : ideas ? <RefreshCw size={18} /> : <Sparkles size={18} />}
            {loading ? 'Recherche…' : ideas ? 'Nouvelles idées' : 'Trouver des recettes'}
          </button>
          {changed && !loading && <p className="footnote recipe__stale">La liste a changé depuis ces idées.</p>}
          {quota && !loading && (
            <p className="footnote recipe__stale">
              Recherche gratuite : {quota.remaining > 0 ? `encore ${quota.remaining} sur ${quota.limit} aujourd’hui.` : 'c’était la dernière d’aujourd’hui.'}
            </p>
          )}
          {outOfQuota && !loading && (
            <button className="btn btn--small" onClick={onOpenSettings}>Entrer un code d’accès</button>
          )}
        </div>
      </div>

      {ideas && ideas.recipes.length === 0 && <p className="empty">Aucune recette trouvée avec cette liste.</p>}
      {ready.length > 0 && (
        <>
          <h3 className="recipe__group">Avec ce qu’il y a dans la liste</h3>
          {ready.map((r) => <RecipeCard key={r.title} recipe={r} missing={[]} />)}
        </>
      )}
      {almost.length > 0 && (
        <>
          <h3 className="recipe__group">Il manque peu</h3>
          {almost.map((r) => <RecipeCard key={r.title} recipe={r} missing={stillMissing(r)} />)}
        </>
      )}
    </div>
  )
}

const missingOf = (r: Recipe) => r.ingredients.filter((i) => i.source === 'missing')

const SOURCE_LABELS: Record<Ingredient['source'], string> = { list: 'Dans la liste', pantry: 'Placard', missing: 'À acheter' }

function RecipeCard({ recipe, missing }: { recipe: Recipe; missing: Ingredient[] }) {
  const [open, setOpen] = useState(false)
  const [kept, setKept] = useState(false)
  const toast = useToast()
  const added = missingOf(recipe).length > 0 && missing.length === 0

  async function addMissing() {
    await addToList(missing.map((i) => i.name).join(','))
    toast(`${missing.length} ingrédient${missing.length > 1 ? 's' : ''} ajouté${missing.length > 1 ? 's' : ''} à la liste`)
  }

  async function keep() {
    await keepRecipe(recipe)
    setKept(true)
    toast('Recette enregistrée dans vos notes')
  }

  return (
    <article className="card recipe">
      <button className="recipe__head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="recipe__icon"><ChefHat size={18} /></span>
        <span className="card__titles">
          <span className="card__title">{recipe.title}</span>
          {recipe.pitch && <span className="recipe__pitch">{recipe.pitch}</span>}
        </span>
        {recipe.minutes > 0 && (
          <span className="badge"><Clock size={13} /> {recipe.minutes} min</span>
        )}
        {open ? <ChevronUp size={18} className="muted" /> : <ChevronDown size={18} className="muted" />}
      </button>

      {missing.length > 0 && <p className="recipe__missing">Il manque : {missing.map((i) => i.name).join(', ')}</p>}
      {added && <p className="recipe__missing recipe__missing--ok"><Check size={14} className="inline-icon" /> Ingrédients ajoutés à la liste</p>}

      {open && (
        <>
          <ul className="recipe__ingredients">
            {recipe.ingredients.map((i) => (
              <li key={i.name} className={`recipe__ingredient recipe__ingredient--${i.source}`}>
                <span>{i.quantity ? `${i.quantity} ` : ''}{i.name}</span>
                <small>{SOURCE_LABELS[i.source]}</small>
              </li>
            ))}
          </ul>
          <ol className="recipe__steps">
            {recipe.steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
        </>
      )}

      <div className="recipe__actions">
        {missing.length > 0 && (
          <button className="btn btn--small" onClick={addMissing}>
            <Plus size={14} /> Ajouter {missing.length > 1 ? `les ${missing.length} ingrédients` : 'l’ingrédient'}
          </button>
        )}
        <button className="btn btn--small" disabled={kept} onClick={keep}>
          {kept ? <Check size={14} /> : <BookmarkPlus size={14} />} {kept ? 'Gardée' : 'Garder la recette'}
        </button>
      </div>
    </article>
  )
}
