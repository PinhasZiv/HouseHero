import { useState } from 'react'
import { errorMessage } from '../lib/errors'
import { formatTime } from '../lib/format'
import { useI18n } from '../lib/i18n'

interface ReminderOverrideSheetProps {
  taskTitle: string
  /** null when this person has no personal override yet - the picker then
   *  opens on the task's own time, which is exactly what saving without
   *  changing anything should reproduce. */
  initialHour: number
  initialMinute: number
  /** Only offered once a personal override actually exists. */
  hasOverride: boolean
  onSave: (hour: number, minute: number) => Promise<void>
  onReset: () => Promise<void>
  onClose: () => void
}

/**
 * Lets one person set their own reminder time for one task, the way
 * SnoozeSheet lets them defer it - personal, never touching the task row, so
 * everyone else in the space keeps seeing (and being reminded by) the time
 * set on the task itself.
 */
export function ReminderOverrideSheet({
  taskTitle,
  initialHour,
  initialMinute,
  hasOverride,
  onSave,
  onReset,
  onClose,
}: ReminderOverrideSheetProps) {
  const { t } = useI18n()
  const [value, setValue] = useState(formatTime(initialHour, initialMinute))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return
    const [h, m] = value.split(':').map(Number)
    if (!Number.isFinite(h) || !Number.isFinite(m)) return
    setBusy(true)
    setError(null)
    try {
      await onSave(h, m)
    } catch (cause) {
      setError(errorMessage(cause))
      setBusy(false)
    }
  }

  async function reset() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await onReset()
    } catch (cause) {
      setError(errorMessage(cause))
      setBusy(false)
    }
  }

  return (
    <div className="sheet-backdrop" onClick={busy ? undefined : onClose} role="presentation">
      <form className="sheet" onClick={(event) => event.stopPropagation()} onSubmit={save}>
        <h2>{t.reminderOverride.title}</h2>
        <p className="screen-subtitle">{taskTitle}</p>
        <p className="muted small">{t.reminderOverride.body}</p>

        <label className="field">
          <span>{t.reminderOverride.timeLabel}</span>
          <input
            type="time"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            disabled={busy}
          />
        </label>

        {error && <p className="error-text">{error}</p>}

        <div className="sheet-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            {t.common.cancel}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {t.common.save}
          </button>
        </div>

        {hasOverride && (
          <button type="button" className="btn btn-danger-text btn-small" onClick={() => void reset()} disabled={busy}>
            {t.reminderOverride.reset}
          </button>
        )}
      </form>
    </div>
  )
}
