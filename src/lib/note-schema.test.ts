import { describe, expect, it } from 'vitest'
import { sanitizeNote } from './note-schema'

describe('sanitizeNote', () => {
  it('rejette ce qui n’est pas une note', () => {
    expect(sanitizeNote(null)).toBeNull()
    expect(sanitizeNote('note')).toBeNull()
    expect(sanitizeNote({ id: 'a', title: 'x' })).toBeNull()
    expect(sanitizeNote({ id: 1, title: 'x', body: '' })).toBeNull()
  })

  it('impose l’identifiant attendu', () => {
    expect(sanitizeNote({ id: 'autre', title: 'x', body: '' }, 'n1')).toBeNull()
    expect(sanitizeNote({ id: 'n1', title: 'x', body: '' }, 'n1')?.id).toBe('n1')
  })

  it('complète et corrige les champs mal formés', () => {
    const note = sanitizeNote({
      id: 'n1',
      title: 'Piscine',
      body: '',
      tags: ['sport', 3, '', 'sport'],
      doneDates: ['2026-01-01', 'hier'],
      pinned: 'oui',
      color: 'fuchsia',
      date: '2026-01-01',
      time: '25:00',
      recurrence: { freq: 'weekly', interval: 0, byWeekday: [1, 9, 1] },
      reminder: -5,
      updatedAt: 'demain',
    })
    expect(note).toMatchObject({
      tags: ['sport'],
      doneDates: ['2026-01-01'],
      pinned: false,
      date: '2026-01-01',
      recurrence: { freq: 'weekly', interval: 1, byWeekday: [1] },
    })
    expect(note).not.toHaveProperty('color')
    expect(note).not.toHaveProperty('time')
    expect(note).not.toHaveProperty('reminder')
    expect(typeof note?.updatedAt).toBe('number')
  })

  it('ignore heure et récurrence sans date', () => {
    const note = sanitizeNote({ id: 'n1', title: '', body: 'x', time: '10:00', recurrence: { freq: 'daily', interval: 1 } })
    expect(note).not.toHaveProperty('time')
    expect(note).not.toHaveProperty('recurrence')
  })
})
