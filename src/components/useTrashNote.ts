import { restoreNote, trashNote } from '../lib/db'
import type { Note } from '../lib/types'
import { useToast } from './Toast'

/** Suppression depuis une liste, avec « Annuler » dans le message. */
export function useTrashNote() {
  const toast = useToast()
  return async (note: Note) => {
    await trashNote(note.id)
    toast(note.shared ? 'Note supprimée pour tout l’espace' : note.recurrence ? 'Note et ses répétitions supprimées' : 'Note placée dans la corbeille', {
      label: 'Annuler',
      run: () => restoreNote(note.id),
    })
  }
}
