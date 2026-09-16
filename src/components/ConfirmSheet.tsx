import { useState } from 'react'
import { errorMessage } from '../lib/errors'
import { useI18n } from '../lib/i18n'

interface ConfirmSheetProps {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => Promise<void>
  onCancel: () => void
}

/**
 * A styled stand-in for window.confirm(), for a destructive action that
 * deserves more than the browser's own dialog - matching the rest of the
 * app's sheets instead of looking like it escaped from a different program,
 * and giving the action somewhere to report a failure that isn't a second
 * native alert().
 */
export function ConfirmSheet({ title, message, confirmLabel, onConfirm, onCancel }: ConfirmSheetProps) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
    } catch (cause) {
      setError(errorMessage(cause))
      setBusy(false)
    }
  }

  return (
    <div className="sheet-backdrop" onClick={busy ? undefined : onCancel} role="presentation">
      <div className="sheet" onClick={(event) => event.stopPropagation()}>
        <h2>{title}</h2>
        <p className="screen-subtitle">{message}</p>

        {error && <p className="error-text">{error}</p>}

        <div className="sheet-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            {t.common.cancel}
          </button>
          <button type="button" className="btn btn-danger" onClick={() => void confirm()} disabled={busy}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
