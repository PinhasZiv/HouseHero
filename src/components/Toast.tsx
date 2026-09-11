import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { errorMessage } from '../lib/errors'

interface ToastAction {
  label: string
  run: () => void | Promise<void>
}

interface ToastMessage {
  id: number
  text: string
  tone: 'info' | 'error' | 'success'
  action?: ToastAction
}

interface ToastContextValue {
  show: (text: string, options?: { action?: ToastAction; tone?: ToastMessage['tone'] }) => void
  showError: (cause: unknown) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const VISIBLE_MS = 6000

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const timer = useRef<number>()

  const show = useCallback<ToastContextValue['show']>((text, options) => {
    window.clearTimeout(timer.current)
    const id = Date.now()
    setToast({ id, text, tone: options?.tone ?? 'info', action: options?.action })
    // A toast that disappears while you reach for it is worse than not
    // offering an undo at all, so the window is generous.
    timer.current = window.setTimeout(() => setToast((current) => (current?.id === id ? null : current)), VISIBLE_MS)
  }, [])

  const showError = useCallback(
    (cause: unknown) => {
      show(errorMessage(cause), { tone: 'error' })
    },
    [show],
  )

  const value = useMemo(() => ({ show, showError }), [show, showError])

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast && (
        <div key={toast.id} className={`toast toast-${toast.tone} toast-enter`} role="status" aria-live="polite">
          <span>{toast.text}</span>
          {toast.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                setToast(null)
                void toast.action?.run()
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

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext)
  if (!value) throw new Error('useToast must be used inside ToastProvider')
  return value
}
