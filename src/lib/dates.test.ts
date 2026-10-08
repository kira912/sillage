import { describe, expect, it } from 'vitest'
import { describeRecurrence, fromKey, nextOccurrence, occursOn } from './dates'
import { noteToIcs } from './ics'
import type { Note, Recurrence } from './types'

const note = (date: string, recurrence: Recurrence): Note => ({
  id: 'n1',
  title: 'Note',
  body: '',
  tags: [],
  pinned: false,
  doneDates: [],
  date,
  recurrence,
  createdAt: 0,
  updatedAt: 0,
})
const on = (n: Note, day: string) => occursOn(n, fromKey(day))

// 2026-10-09 est un vendredi.
describe('weekendToMonday', () => {
  it('ne garde que les jours de semaine pour une répétition quotidienne', () => {
    const n = note('2026-10-09', { freq: 'daily', interval: 1, weekendToMonday: true })
    expect(['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12'].map((d) => on(n, d))).toEqual([true, false, false, true])
    expect(nextOccurrence(n, fromKey('2026-10-10'))).toEqual(fromKey('2026-10-12'))
  })

  it('reporte au lundi une occurrence mensuelle tombant un samedi ou un dimanche', () => {
    const sat = note('2026-10-10', { freq: 'monthly', interval: 1, weekendToMonday: true })
    expect(on(sat, '2026-10-10')).toBe(false)
    expect(on(sat, '2026-10-12')).toBe(true)
    expect(on(sat, '2026-11-10')).toBe(true) // mardi : pas de report
    expect(on(sat, '2026-11-12')).toBe(false)
    const sun = note('2026-10-11', { freq: 'monthly', interval: 1, weekendToMonday: true })
    expect(on(sun, '2026-10-12')).toBe(true)
  })

  it('reporte même après la date de fin', () => {
    const n = note('2026-10-10', { freq: 'monthly', interval: 1, until: '2026-10-10', weekendToMonday: true })
    expect(nextOccurrence(n, fromKey('2026-10-11'))).toEqual(fromKey('2026-10-12'))
  })

  it('n’a pas d’effet sur une répétition hebdomadaire', () => {
    const n = note('2026-10-10', { freq: 'weekly', interval: 1, weekendToMonday: true })
    expect(on(n, '2026-10-17')).toBe(true)
    expect(on(n, '2026-10-19')).toBe(false)
  })

  it('apparaît dans la description et dans le fichier .ics', () => {
    const daily: Recurrence = { freq: 'daily', interval: 1, weekendToMonday: true }
    expect(describeRecurrence(daily)).toBe('Tous les jours, sauf le week-end')
    expect(describeRecurrence({ freq: 'monthly', interval: 1, weekendToMonday: true })).toBe('Tous les mois, reporté au lundi le week-end')
    expect(noteToIcs(note('2026-10-09', daily))).toContain('RRULE:FREQ=DAILY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR')
  })
})
