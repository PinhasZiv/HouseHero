import { useEffect, useId, useRef } from 'react'
import { createBackStack } from './backStack'

const backStack = createBackStack(window.history, (run) => queueMicrotask(run))
window.addEventListener('popstate', () => backStack.handlePopState())

/** Makes back (Android's button, a browser's) run `onBack` while `active`. */
export function useBackClose(onBack: () => void, active = true): void {
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack
  useEffect(() => {
    if (!active) return
    return backStack.register(() => onBackRef.current())
  }, [active])
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Everything a sheet needs to behave as a modal dialog: back and Escape close
 * it (only the topmost one, when sheets stack), focus moves into it on open
 * and back to where it was on close, and Tab cycles inside it rather than
 * wandering into the page underneath.
 *
 * Spread `dialogProps` on the sheet element and put `titleId` on its heading.
 * `closable: false` is for a sheet with nothing to go back to (the first-run
 * space setup).
 */
export function useDialog<T extends HTMLElement = HTMLElement>(onClose: () => void, options?: { closable?: boolean }) {
  const ref = useRef<T>(null)
  const titleId = useId()
  const closable = options?.closable ?? true
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!closable) return
    const unregister = backStack.register(() => onCloseRef.current())
    const onKeyDown = (event: KeyboardEvent) => {
      if (!backStack.isTop(unregister)) return
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
      } else if (event.key === 'Tab' && ref.current) {
        const focusable = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE))
        if (focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      unregister()
    }
  }, [closable])

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const element = ref.current
    if (element && !element.contains(document.activeElement)) element.focus({ preventScroll: true })
    return () => {
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true })
    }
  }, [])

  return {
    titleId,
    dialogProps: {
      ref,
      role: 'dialog' as const,
      'aria-modal': true as const,
      'aria-labelledby': titleId,
      tabIndex: -1,
    },
  }
}
