import { describe, expect, it } from 'vitest'
import { onList, reconcile, type Recipe } from './recipes'
import { itemKey } from './shopping'

const recipe = (ingredients: Recipe['ingredients']): Recipe => ({ title: 'Quiche', pitch: '', minutes: 40, ingredients, steps: ['Cuire.'] })
const sources = (r: Recipe) => Object.fromEntries(r.ingredients.map((i) => [i.name, i.source]))

describe('onList', () => {
  const keys = ['Crème fraîche', 'Tomates', 'œufs'].map(itemKey)

  it('reconnaît un article malgré casse, accents, pluriel et ligature', () => {
    expect(onList('tomate', keys)).toBe(true)
    expect(onList('Oeufs', keys)).toBe(true)
  })

  it('accepte un nom plus général que l’article, pas l’inverse', () => {
    expect(onList('crème', keys)).toBe(true)
    expect(onList('crème liquide', keys)).toBe(false)
  })
})

describe('reconcile', () => {
  it('rattache à la liste un ingrédient « à acheter » qui y est déjà', () => {
    const [r] = reconcile([recipe([{ name: 'crème', quantity: '20 cl', source: 'missing' }])], ['crème fraîche'])
    expect(sources(r)).toEqual({ crème: 'list' })
  })

  it('passe « à acheter » un ingrédient prétendu dans la liste mais introuvable', () => {
    const [r] = reconcile([recipe([{ name: 'lardons', quantity: '200 g', source: 'list' }])], ['œufs'])
    expect(sources(r)).toEqual({ lardons: 'missing' })
  })

  it('garde un nom plus précis que l’article de la liste', () => {
    const [r] = reconcile([recipe([{ name: 'tomates cerises', quantity: '', source: 'list' }])], ['tomates'])
    expect(sources(r)).toEqual({ 'tomates cerises': 'list' })
  })

  it('écarte une recette à laquelle il manque plus de 3 ingrédients après correction', () => {
    const many = ['a', 'b', 'c', 'd'].map((name) => ({ name: `produit ${name}`, quantity: '', source: 'list' as const }))
    expect(reconcile([recipe(many)], ['œufs'])).toEqual([])
  })

  it('ne touche pas aux basiques du placard', () => {
    const [r] = reconcile([recipe([{ name: 'sel', quantity: '', source: 'pantry' }])], [])
    expect(sources(r)).toEqual({ sel: 'pantry' })
  })
})
