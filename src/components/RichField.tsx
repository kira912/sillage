import { useEffect, useImperativeHandle, useLayoutEffect, useRef, type ClipboardEvent, type FormEvent, type KeyboardEvent, type MouseEvent, type Ref } from 'react'
import { COLOR_IDS, NO_COLOR_ID, fromDom, toHtml } from '../lib/richdom'
import type { TextColor } from '../lib/richtext'

export type FormatCommand = 'bold' | 'italic' | 'underline' | 'strikeThrough'

export interface RichFieldHandle {
  /** Applique une mise en forme à la sélection (ou au texte tapé ensuite). */
  format: (command: FormatCommand) => void
  color: (color: TextColor | null) => void
  /** Transforme la ligne en case à cocher, ou l'inverse. */
  toggleChecklist: () => void
  /** Curseur à la fin du texte. */
  focus: () => void
}

interface Props {
  ref?: Ref<RichFieldHandle>
  value: string
  onChange: (value: string) => void
  /** Plusieurs lignes et cases à cocher (texte de la note) ; sinon une seule ligne (titre). */
  multiline?: boolean
  label: string
  placeholder: string
  className: string
  autoFocus?: boolean
  /** Une seule ligne : touche Entrée. */
  onEnter?: () => void
  /** Le champ reçoit le focus : la barre de mise en forme agit sur lui. */
  onActivate?: () => void
}

/** Largeur de la zone, à gauche d'une ligne, qui coche la case. */
const CHECK_GUTTER = 30

/**
 * Champ de texte mis en forme. Le texte balisé (`value`) n'est réécrit dans le champ que s'il change de
 * l'extérieur (synchronisation, « Tout décocher »…) : pendant la saisie, le curseur n'est jamais déplacé.
 */
export function RichField({ ref, value, onChange, multiline = false, label, placeholder, className, autoFocus, onEnter, onActivate }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const written = useRef<string | null>(null)
  /** Dernière sélection dans le champ : un bouton de la barre peut l'avoir fait perdre. */
  const saved = useRef<Range | null>(null)

  useLayoutEffect(() => {
    if (!el.current || value === written.current) return
    el.current.innerHTML = toHtml(value, multiline)
    written.current = value
  }, [value, multiline])

  useEffect(() => {
    if (autoFocus && el.current) placeCaret(el.current, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onSelection = () => {
      const sel = getSelection()
      if (sel?.rangeCount && el.current?.contains(sel.anchorNode)) saved.current = sel.getRangeAt(0).cloneRange()
    }
    document.addEventListener('selectionchange', onSelection)
    return () => document.removeEventListener('selectionchange', onSelection)
  }, [])

  function emit() {
    if (!el.current) return
    const next = fromDom(el.current, multiline)
    written.current = next
    onChange(next)
  }

  /** Remet le focus et la sélection dans le champ avant une commande. */
  function restore() {
    const root = el.current!
    if (document.activeElement === root) return
    root.focus()
    const sel = getSelection()
    if (saved.current && root.contains(saved.current.startContainer)) {
      sel?.removeAllRanges()
      sel?.addRange(saved.current)
    } else placeCaret(root, false)
  }

  useImperativeHandle(ref, () => ({
    focus() {
      if (el.current) placeCaret(el.current, false)
    },
    format(command) {
      restore()
      document.execCommand('styleWithCSS', false, 'false')
      document.execCommand(command)
      emit()
    },
    color(color) {
      restore()
      document.execCommand('styleWithCSS', false, 'false')
      document.execCommand('foreColor', false, color ? COLOR_IDS[color] : NO_COLOR_ID)
      emit()
    },
    toggleChecklist() {
      if (!multiline) return
      restore()
      const root = el.current!
      let block = blockAt(root)
      if (!block) {
        // Texte hors d'une ligne (champ vidé puis retapé) : on remet le champ en lignes, curseur à la fin.
        emit()
        root.innerHTML = toHtml(written.current ?? '', true)
        block = root.lastElementChild as HTMLElement | null
        if (block) placeCaret(block, false)
      }
      if (!block) return
      if (block.dataset.check === undefined) block.dataset.check = ' '
      else delete block.dataset.check
      emit()
    },
  }))

  function onInput(e: FormEvent<HTMLDivElement>) {
    if (multiline && (e.nativeEvent as InputEvent).inputType === 'insertParagraph') continueChecklist(el.current!)
    emit()
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!multiline && e.key === 'Enter') {
      e.preventDefault()
      onEnter?.()
    }
  }

  // Le collage garde le texte, pas la mise en forme d'une autre app.
  function onPaste(e: ClipboardEvent<HTMLDivElement>) {
    e.preventDefault()
    let text = e.clipboardData.getData('text/plain')
    if (!multiline) text = text.replace(/\s*\n\s*/g, ' ')
    document.execCommand('insertText', false, text)
  }

  function onClick(e: MouseEvent<HTMLDivElement>) {
    if (!multiline) return
    const block = (e.target as HTMLElement).closest<HTMLElement>('[data-check]')
    if (!block || !el.current?.contains(block)) return
    if (e.clientX - block.getBoundingClientRect().left > CHECK_GUTTER) return
    block.dataset.check = block.dataset.check === 'x' ? ' ' : 'x'
    emit()
  }

  return (
    <div
      ref={el}
      className={`rich ${className}${value ? '' : ' rich--empty'}`}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline={multiline}
      aria-label={label}
      data-placeholder={placeholder}
      enterKeyHint={multiline ? 'enter' : 'next'}
      onInput={onInput}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onClick={onClick}
      onFocus={onActivate}
    />
  )
}

/** Ligne (bloc de premier niveau) qui contient le curseur. */
function blockAt(root: HTMLElement): HTMLElement | null {
  let node = getSelection()?.anchorNode ?? null
  while (node && node.parentNode !== root) node = node.parentNode
  return node instanceof HTMLElement && node !== root ? node : null
}

/**
 * Après Entrée : la nouvelle ligne d'une liste est une case vide ; Entrée sur une case vide sort de la liste
 * (comme dans Notes).
 */
function continueChecklist(root: HTMLElement) {
  const block = blockAt(root)
  if (!block) return
  const prev = block.previousElementSibling as HTMLElement | null
  if (prev?.dataset.check === undefined) {
    delete block.dataset.check
    return
  }
  if (!prev.textContent?.trim() && !block.textContent?.trim()) {
    delete prev.dataset.check
    block.remove()
    placeCaret(prev, true)
    return
  }
  block.dataset.check = ' '
}

function placeCaret(target: HTMLElement, atStart: boolean) {
  target.focus()
  const range = document.createRange()
  range.selectNodeContents(target)
  range.collapse(atStart)
  const sel = getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}
