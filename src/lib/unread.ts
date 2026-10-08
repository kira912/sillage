import { db } from './db'
import type { Note } from './types'

/*
 * Nouveautés de l'espace partagé : notes ajoutées (ou mises dans l'agenda) par un autre membre, pas encore vues
 * sur ce téléphone. Le marqueur `unread` est propre au téléphone et n'est jamais synchronisé.
 */

export const unreadNotes = () => db.notes.filter((n) => !!n.unread && !n.deletedAt).toArray()

/** Les notes datées vont dans l'agenda, les autres dans Notes. */
export const unreadTab = (n: Note): 'agenda' | 'notes' => (n.date ? 'agenda' : 'notes')

export async function markRead(where: (n: Note) => boolean) {
  await db.notes.filter((n) => !!n.unread && where(n)).modify((n) => void delete n.unread)
}
