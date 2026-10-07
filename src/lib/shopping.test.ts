import { describe, expect, it } from 'vitest'
import { addItems, aisleOf, describeQty, groupByAisle, itemKey, mergeLists, parseItem, parseItems, setItemQty, splitInput } from './shopping'

describe('parseItem', () => {
  it('lit la quantité et l’unité', () => {
    expect(parseItem('lait')).toEqual({ name: 'lait' })
    expect(parseItem('2 baguettes')).toEqual({ qty: 2, unit: undefined, name: 'baguettes' })
    expect(parseItem('500g farine')).toEqual({ qty: 500, unit: 'g', name: 'farine' })
    expect(parseItem('1,5 L lait')).toEqual({ qty: 1.5, unit: 'l', name: 'lait' })
    expect(parseItem('œufs x6')).toEqual({ qty: 6, name: 'œufs' })
    expect(parseItem('   ')).toBeNull()
  })

  it('découpe une saisie en plusieurs articles', () => {
    expect(splitInput('lait, 2 pains ; ,œufs').map((i) => i.name)).toEqual(['lait', 'pains', 'œufs'])
  })
})

describe('addItems', () => {
  it('ajoute à la fin', () => {
    expect(addItems('', splitInput('lait, 2 baguettes'))).toBe('- [ ] lait\n- [ ] 2 baguettes')
  })

  it('additionne les quantités d’un article déjà présent (pluriel et accents ignorés)', () => {
    expect(addItems('- [ ] lait', splitInput('Lait'))).toBe('- [ ] 2 lait')
    expect(addItems('- [ ] 2 tomates', splitInput('3 tomate'))).toBe('- [ ] 5 tomates')
    expect(addItems('- [ ] 500 g farine', splitInput('250 g farine'))).toBe('- [ ] 750 g farine')
  })

  it('garde séparés deux articles d’unités différentes', () => {
    expect(addItems('- [ ] 500 g farine', splitInput('farine'))).toBe('- [ ] 500 g farine\n- [ ] farine')
  })

  it('remet à acheter un article déjà coché, avec la nouvelle quantité', () => {
    expect(addItems('- [x] 4 yaourts', splitInput('yaourts'))).toBe('- [ ] yaourts')
  })

  it('ne touche pas aux autres lignes', () => {
    expect(addItems('Pour dimanche\n- [ ] pain', splitInput('pain'))).toBe('Pour dimanche\n- [ ] 2 pain')
  })
})

describe('setItemQty', () => {
  it('change la quantité ; 1 ou moins la retire', () => {
    const [item] = parseItems('- [ ] 3 kiwis')
    expect(setItemQty('- [ ] 3 kiwis', item, 2)).toBe('- [ ] 2 kiwis')
    expect(setItemQty('- [ ] 3 kiwis', item, undefined)).toBe('- [ ] kiwis')
  })
})

describe('describeQty', () => {
  it('formate les quantités', () => {
    expect(describeQty({ qty: 2 })).toBe('×2')
    expect(describeQty({ qty: 1.5, unit: 'l' })).toBe('1,5 l')
    expect(describeQty({})).toBe('')
  })
})

describe('rayons', () => {
  it('classe les articles courants', () => {
    expect(aisleOf('Tomates cerises')).toBe('Fruits et légumes')
    expect(aisleOf('pommes de terre')).toBe('Fruits et légumes')
    expect(aisleOf('Œufs')).toBe('Crèmerie')
    expect(aisleOf('liquide vaisselle')).toBe('Entretien')
    expect(aisleOf('papier toilette')).toBe('Hygiène et beauté')
    expect(aisleOf('baguette')).toBe('Boulangerie')
    expect(aisleOf('truc inconnu')).toBe('Autres')
  })

  it('suit l’ordre du magasin, « Autres » en dernier', () => {
    const groups = groupByAisle(parseItems('- [ ] gadget\n- [ ] lessive\n- [ ] pommes\n- [ ] lait'))
    expect(groups.map((g) => g.aisle)).toEqual(['Fruits et légumes', 'Crèmerie', 'Entretien', 'Autres'])
  })
})

describe('mergeLists', () => {
  it('ajoute à la liste de l’espace les articles à acheter qui lui manquent', () => {
    expect(mergeLists('- [ ] lait\n- [ ] Pain\n- [x] beurre', '- [ ] pains\n- [ ] œufs')).toBe('- [ ] pains\n- [ ] œufs\n- [ ] lait')
    expect(mergeLists('- [ ] lait', '')).toBe('- [ ] lait')
  })
})

it('itemKey ignore casse, accents, ligatures et pluriel', () => {
  expect(itemKey('Œufs frais')).toBe(itemKey('oeuf frai'))
  expect(itemKey('Crème')).toBe('creme')
})
