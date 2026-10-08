import { Bold, Italic, ListChecks, Palette, Strikethrough, Underline } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { marksOf } from '../lib/richdom'
import { TEXT_COLORS, type TextColor } from '../lib/richtext'
import type { FormatCommand, RichFieldHandle } from './RichField'

const COLOR_LABELS: Record<TextColor, string> = {
  rouge: 'Rouge',
  orange: 'Orange',
  vert: 'Vert',
  bleu: 'Bleu',
  violet: 'Violet',
  rose: 'Rose',
}

interface Props {
  /** Champ visé : le dernier qui a eu le focus. */
  target: () => RichFieldHandle | null
  /** Champ visé : le titre est déjà en gras et n'a pas de cases à cocher. */
  field: 'title' | 'body'
}

/**
 * Barre de mise en forme de l'éditeur. Ses boutons ne prennent pas le focus : la sélection reste dans le texte.
 */
export function FormatBar({ target, field }: Props) {
  const [active, setActive] = useState<Record<FormatCommand, boolean>>({ bold: false, italic: false, underline: false, strikeThrough: false })
  const [colorsOpen, setColorsOpen] = useState(false)

  // État des boutons selon la mise en forme du texte au curseur (pas le style affiché : une case cochée est
  // barrée sans que son texte le soit).
  useEffect(() => {
    const update = () => {
      const root = document.activeElement as HTMLElement | null
      const anchor = getSelection()?.anchorNode
      if (!root?.isContentEditable || !anchor || !root.contains(anchor)) return
      const marks = marksOf(anchor, root)
      setActive({ bold: !!marks.b, italic: !!marks.i, underline: !!marks.u, strikeThrough: !!marks.s })
    }
    document.addEventListener('selectionchange', update)
    return () => document.removeEventListener('selectionchange', update)
  }, [])

  function format(command: FormatCommand) {
    target()?.format(command)
    setActive((a) => ({ ...a, [command]: document.queryCommandState(command) }))
  }

  function color(c: TextColor | null) {
    target()?.color(c)
    setColorsOpen(false)
  }

  return (
    <div className="format-bar">
      <div className="format-bar__row" role="toolbar" aria-label="Mise en forme">
        <FormatButton label="Gras" pressed={field === 'body' && active.bold} disabled={field === 'title'} onPress={() => format('bold')}>
          <Bold size={19} />
        </FormatButton>
        <FormatButton label="Italique" pressed={active.italic} onPress={() => format('italic')}><Italic size={19} /></FormatButton>
        <FormatButton label="Souligné" pressed={active.underline} onPress={() => format('underline')}><Underline size={19} /></FormatButton>
        <FormatButton label="Barré" pressed={active.strikeThrough} onPress={() => format('strikeThrough')}><Strikethrough size={19} /></FormatButton>
        <FormatButton label="Couleur du texte" pressed={colorsOpen} onPress={() => setColorsOpen(!colorsOpen)}><Palette size={19} /></FormatButton>
        {field === 'body' && (
          <FormatButton label="Case à cocher" onPress={() => target()?.toggleChecklist()}><ListChecks size={19} /></FormatButton>
        )}
      </div>
      {colorsOpen && (
        <div className="format-bar__colors" role="group" aria-label="Couleur du texte">
          <button className="text-swatch text-swatch--none" aria-label="Sans couleur" onMouseDown={(e) => e.preventDefault()} onClick={() => color(null)} />
          {TEXT_COLORS.map((c) => (
            <button
              key={c}
              className="text-swatch"
              data-color={c}
              aria-label={COLOR_LABELS[c]}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => color(c)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function FormatButton({
  label,
  pressed,
  disabled,
  onPress,
  children,
}: {
  label: string
  pressed?: boolean
  /** Le titre est déjà en gras : le bouton reste visible, inactif. */
  disabled?: boolean
  onPress: () => void
  children: ReactNode
}) {
  return (
    <button
      className="format-bar__btn"
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      // Garder le focus dans le texte : sinon la sélection est perdue avant la commande.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPress}
    >
      {children}
    </button>
  )
}
