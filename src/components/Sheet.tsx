import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'

/**
 * Feuille qui monte du bas de l'écran. Repose sur <dialog> : focus gardé dans la feuille, fond inerte et
 * touche Échap gérés par le navigateur. Toucher le fond la ferme.
 */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={title ? titleId : undefined}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      {open && (
        <div className="sheet__panel">
          {title && <h2 id={titleId} className="sheet__title">{title}</h2>}
          {children}
        </div>
      )}
    </dialog>
  )
}

export function SheetItem({ icon, children, onClick, danger }: { icon: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button className={`sheet__item${danger ? ' sheet__item--danger' : ''}`} onClick={onClick}>
      {icon}
      {children}
    </button>
  )
}

interface ConfirmOptions {
  title: string
  message?: string
  /** Libellé de l'action, qui dit ce qui va se passer (« Vider la corbeille », pas « OK »). */
  confirmLabel: string
  danger?: boolean
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<Confirm>(async () => false)

export const useConfirm = () => useContext(ConfirmContext)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null)

  const confirm = useCallback<Confirm>((options) => new Promise((resolve) => setRequest({ ...options, resolve })), [])

  function settle(ok: boolean) {
    request?.resolve(ok)
    setRequest(null)
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Sheet open={!!request} onClose={() => settle(false)} title={request?.title}>
        {request?.message && <p className="sheet__text">{request.message}</p>}
        <div className="sheet__actions">
          <button className={`btn btn--block ${request?.danger ? 'btn--danger' : 'btn--primary'}`} onClick={() => settle(true)}>
            {request?.confirmLabel}
          </button>
          <button className="btn btn--block" onClick={() => settle(false)}>Annuler</button>
        </div>
      </Sheet>
    </ConfirmContext.Provider>
  )
}
