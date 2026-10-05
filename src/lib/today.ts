import { startOfDay } from 'date-fns'
import { useSyncExternalStore } from 'react'

/*
 * Date du jour (à minuit), mise à jour au changement de jour : une PWA reste souvent ouverte en
 * arrière-plan pendant des jours, et doit afficher le bon « aujourd'hui » à son retour.
 * Une seule horloge pour toute l'app, quel que soit le nombre de composants abonnés.
 */

let today = startOfDay(new Date())
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | undefined

function check() {
  const now = startOfDay(new Date())
  if (now.getTime() === today.getTime()) return
  today = now
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  if (!listeners.size) {
    timer = setInterval(check, 60_000)
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
