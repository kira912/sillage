import { toKey } from './dates'
import { exportJson } from './db'

/** Enregistre une sauvegarde JSON : feuille de partage sur iPhone (Fichiers / iCloud Drive), sinon téléchargement. */
export async function saveBackup() {
  const file = new File([await exportJson()], `sillage-${toKey(new Date())}.json`, { type: 'application/json' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Sauvegarde Sillage' })
      return
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
    }
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(file)
  a.download = file.name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}
