import { describe, expect, it } from 'vitest'
import { parseLine, plainText, serializeLine, type Segment } from './richtext'

describe('mise en forme du texte', () => {
  it('lit gras, italique, souligné, barré et couleur', () => {
    expect(parseLine('a **gras** *it* __sou__ ~~bar~~ {rouge}rouge{/}')).toEqual<Segment[]>([
      { text: 'a ', marks: {} },
      { text: 'gras', marks: { b: true } },
      { text: ' ', marks: {} },
      { text: 'it', marks: { i: true } },
      { text: ' ', marks: {} },
      { text: 'sou', marks: { u: true } },
      { text: ' ', marks: {} },
      { text: 'bar', marks: { s: true } },
      { text: ' ', marks: {} },
      { text: 'rouge', marks: { color: 'rouge' } },
    ])
  })

  it('combine les mises en forme imbriquées', () => {
    expect(parseLine('{bleu}**a *b***{/}')).toEqual<Segment[]>([
      { text: 'a ', marks: { b: true, color: 'bleu' } },
      { text: 'b', marks: { b: true, i: true, color: 'bleu' } },
    ])
  })

  it('laisse tel quel un délimiteur sans partenaire (anciennes notes)', () => {
    expect(parseLine('5 * 3 = 15')).toEqual([{ text: '5 * 3 = 15', marks: {} }])
    expect(parseLine('{rouge} sans fin')).toEqual([{ text: '{rouge} sans fin', marks: {} }])
    expect(parseLine('chemin C:\\dossier')).toEqual([{ text: 'chemin C:\\dossier', marks: {} }])
  })

  it('relit exactement ce qu’il écrit, caractères spéciaux compris', () => {
    const segments: Segment[] = [
      { text: '2 * 3 ', marks: {} },
      { text: 'très ', marks: { b: true } },
      { text: 'important_', marks: { b: true, i: true, color: 'rose' } },
      { text: ' {fin} \\ ~', marks: { u: true } },
    ]
    const line = serializeLine(segments)
    expect(parseLine(line)).toEqual(segments)
  })

  it('donne le texte brut, cases à cocher comprises', () => {
    expect(plainText('**Titre** en {vert}vert{/}\n- [x] *lait*\n2 \\* 3')).toBe('Titre en vert\n- [x] lait\n2 * 3')
  })
})
