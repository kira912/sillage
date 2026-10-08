import { format, startOfDay } from 'date-fns'
import { useSyncExternalStore } from 'react'

/*
 * Date du jour (à minuit), mise à jour au changement de jour : une PWA reste souvent ouverte en
 * arrière-plan pendant des jours, et doit afficher le bon « aujourd'hui » à son retour.
 * Une seule horloge pour toute l'app, quel que soit le nombre de composants abonnés.
 */

let today = startOfDay(new Date())
/** Heure actuelle (HH:mm), pour situer « maintenant » dans la journée. */
let minute = format(new Date(), 'HH:mm')
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | undefined

function check() {
  const date = new Date()
  const day = startOfDay(date)
  const hm = format(date, 'HH:mm')
  if (day.getTime() === today.getTime() && hm === minute) return
  // Même objet tant que le jour ne change pas : les calculs qui dépendent de `today` ne sont pas refaits chaque minute.
  if (day.getTime() !== today.getTime()) today = day
  minute = hm
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  if (!listeners.size) {
    timer = setInterval(check, 30_000)
    document.addEventListener('visibilitychange', check)
  }
  listeners.add(listener)
  check()
  return () => {
    listeners.delete(listener)
    if (listeners.size) return
    clearInterval(timer)
    document.removeEventListener('visibilitychange', check)
  }
}

export function useToday(): Date {
  return useSyncExternalStore(subscribe, () => today)
}

export function useMinute(): string {
  return useSyncExternalStore(subscribe, () => minute)
}
