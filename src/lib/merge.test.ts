import { describe, expect, it } from 'vitest'
import { mergeLines, mergeNotes, mergeSets } from './merge'
import type { SharedNote } from './types'

const note = (patch: Partial<SharedNote> = {}): SharedNote => ({
  id: 'n1',
  title: 'Courses',
  body: '- [ ] lait\n- [ ] pain\n- [ ] œufs',
  tags: ['courses'],
  pinned: false,
  doneDates: [],
  createdAt: 1,
  updatedAt: 1,
  ...patch,
})

describe('mergeLines', () => {
  const base = '- [ ] lait\n- [ ] pain\n- [ ] œufs'

  it('garde les cases cochées des deux côtés', () => {
    expect(mergeLines(base, '- [x] lait\n- [ ] pain\n- [ ] œufs', '- [ ] lait\n- [ ] pain\n- [x] œufs')).toBe(
      '- [x] lait\n- [ ] pain\n- [x] œufs',
    )
  })

  it('combine un ajout et une case cochée', () => {
    expect(mergeLines(base, base + '\n- [ ] beurre', '- [ ] lait\n- [x] pain\n- [ ] œufs')).toBe(
      '- [ ] lait\n- [x] pain\n- [ ] œufs\n- [ ] beurre',
    )
  })

  it('garde les ajouts des deux côtés au même endroit', () => {
    expect(mergeLines(base, base + '\n- [ ] beurre', base + '\n- [ ] sel')).toBe(base + '\n- [ ] beurre\n- [ ] sel')
    expect(mergeLines(base, base + '\n- [ ] sel', base + '\n- [ ] sel')).toBe(base + '\n- [ ] sel')
  })

  it('applique « Retirer les cochés » d’un côté et une case cochée de l’autre', () => {
    const checked = '- [x] lait\n- [ ] pain\n- [ ] œufs'
    expect(mergeLines(checked, '- [ ] pain\n- [ ] œufs', '- [x] lait\n- [ ] pain\n- [x] œufs')).toBe('- [ ] pain\n- [x] œufs')
  })

  it('refuse de choisir quand la même ligne est réécrite des deux côtés', () => {
    expect(mergeLines('Rendez-vous à 10h', 'Rendez-vous à 11h', 'Rendez-vous à 9h')).toBeNull()
  })
})

describe('mergeSets', () => {
  it('additionne les ajouts et respecte les retraits', () => {
    expect(mergeSets(['a', 'b'], ['a', 'b', 'c'], ['b', 'd'])).toEqual(['b', 'c', 'd'])
  })
})

describe('mergeNotes', () => {
  it('prend chaque champ du côté qui l’a modifié', () => {
    const base = note()
    const { note: merged, conflict } = mergeNotes(
      base,
      note({ title: 'Courses samedi', updatedAt: 5 }),
      note({ date: '2026-10-10', tags: ['courses', 'famille'], updatedAt: 3 }),
    )
    expect(conflict).toBe(false)
    expect(merged).toMatchObject({ title: 'Courses samedi', date: '2026-10-10', tags: ['courses', 'famille'], updatedAt: 5 })
  })

  it('signale un vrai conflit et garde la version du serveur', () => {
    const { note: merged, conflict } = mergeNotes(note(), note({ title: 'Local' }), note({ title: 'Serveur' }))
    expect(conflict).toBe(true)
    expect(merged.title).toBe('Serveur')
  })

  it('ne signale pas de conflit pour un champ secondaire', () => {
    const { conflict } = mergeNotes(note(), note({ color: 'sky' }), note({ color: 'rose' }))
    expect(conflict).toBe(false)
  })

  it('considère une valeur absente et `undefined` comme identiques', () => {
    const { note: merged, conflict } = mergeNotes(note(), note({ location: undefined }), note({ location: 'Paris' }))
    expect(conflict).toBe(false)
    expect(merged.location).toBe('Paris')
  })
})
