import { Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from 'react'

const ACTION_WIDTH = 88
/** Au-delà de cette fraction de la largeur, relâcher supprime directement (comme sur iOS). */
const FULL_SWIPE = 0.55
const OPEN_EVENT = 'sillage:swipe-open'

interface Props {
  id: string
  onDelete: () => void
  children: ReactNode
}

/** Glisser vers la gauche révèle « Supprimer » ; un glissement long supprime directement. */
export function SwipeToDelete({ id, onDelete, children }: Props) {
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const content = useRef<HTMLDivElement>(null)
  const start = useRef<{ x: number; y: number; base: number } | null>(null)
  const drag = useRef({ active: false, offset: 0, moved: false })

  // Une seule carte ouverte à la fois.
  useEffect(() => {
    const onOpen = (e: Event) => {
      if ((e as CustomEvent<string>).detail === id) return
      drag.current.offset = 0
      setOffset(0)
    }
    window.addEventListener(OPEN_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_EVENT, onOpen)
  }, [id])

  const width = () => content.current?.offsetWidth ?? 320

  function move(value: number) {
    drag.current.offset = value
    setOffset(value)
  }

  function onPointerDown(e: PointerEvent) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    start.current = { x: e.clientX, y: e.clientY, base: offset }
    drag.current.moved = false
  }

  function onPointerMove(e: PointerEvent) {
    const s = start.current
    if (!s) return
    const dx = e.clientX - s.x
    const dy = e.clientY - s.y
    if (!drag.current.active) {
      // Geste vertical : on laisse la page défiler.
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) return void (start.current = null)
      if (Math.abs(dx) < 10) return
      drag.current.active = drag.current.moved = true
      setDragging(true)
      content.current?.setPointerCapture(e.pointerId)
      window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }))
    }
    move(Math.min(0, Math.max(-width(), s.base + dx)))
  }

  function onPointerEnd() {
    start.current = null
    if (!drag.current.active) return
    drag.current.active = false
    setDragging(false)
    const current = drag.current.offset
    if (current < -width() * FULL_SWIPE) {
      move(-width())
      setTimeout(onDelete, 160)
    } else {
      move(current < -ACTION_WIDTH / 2 ? -ACTION_WIDTH : 0)
    }
  }

  // Après un glissement, ou si la carte est ouverte, un tap referme au lieu d'ouvrir la note.
  function onClickCapture(e: MouseEvent) {
    if (drag.current.moved) {
      // Clic émis par le navigateur à la fin du glissement lui-même : on l'ignore.
      e.stopPropagation()
      drag.current.moved = false
    } else if (drag.current.offset !== 0) {
      e.stopPropagation()
      move(0)
    }
  }

  return (
    <div className="swipe">
      <button
        className="swipe__action"
        style={{ width: Math.max(ACTION_WIDTH, -offset) }}
        onClick={onDelete}
        tabIndex={offset ? 0 : -1}
        aria-hidden={!offset}
      >
        <Trash2 size={20} />
        <span>Supprimer</span>
      </button>
      <div
        ref={content}
        className={`swipe__content${dragging ? ' swipe__content--dragging' : ''}`}
        style={{ transform: offset ? `translateX(${offset}px)` : undefined }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={onClickCapture}
      >
        {children}
      </div>
    </div>
  )
}
