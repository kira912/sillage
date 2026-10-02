import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

interface ToastData {
  id: number
  message: string
  action?: { label: string; run: () => void }
}

type Show = (message: string, action?: ToastData['action']) => void

const ToastContext = createContext<Show>(() => {})

export const useToast = () => useContext(ToastContext)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastData | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const show = useCallback<Show>((message, action) => {
    clearTimeout(timer.current)
    setToast({ id: Date.now(), message, action })
    timer.current = setTimeout(() => setToast(null), action ? 5000 : 2500)
  }, [])

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        <div className="toast" role="status" key={toast.id}>
          <span>{toast.message}</span>
          {toast.action && (
            <button
              className="toast__action"
              onClick={() => {
                toast.action!.run()
                setToast(null)
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </ToastContext.Provider>
  )
}
