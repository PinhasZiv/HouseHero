import { useState } from 'react'
import { errorMessage } from '../lib/errors'
import { useI18n } from '../lib/i18n'
import {
  SNOOZE_PRESETS,
  isValidSnoozeInstant,
  snoozeUntilInMinutes,
  toDatetimeLocalValue,
} from '../lib/snoozeOptions'
import type { Task } from '../lib/types'
import { ClockIcon } from './Icons'

interface SnoozeSheetProps {
  /** One task for the per-card button, or everything due for the bulk,
   * notification-triggered picker - both go through the same sheet. */
  tasks: Task[]
  onConfirm: (until: string) => Promise<void>
  onClose: () => void
}

/** A little over the minimum, so the picker never opens pre-filled with a value that reads as invalid the instant it renders. */
function defaultCustomValue(): string {
  return toDatetimeLocalValue(new Date(Date.now() + 2 * 60 * 60_000))
}

export function SnoozeSheet({ tasks, onConfirm, onClose }: SnoozeSheetProps) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [customOpen, setCustomOpen] = useState(false)
  const [customValue, setCustomValue] = useState(defaultCustomValue)
  const [error, setError] = useState<string | null>(null)

  async function confirm(until: string) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await onConfirm(until)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  function chooseCustom(event: React.FormEvent) {
    event.preventDefault()
    if (!isValidSnoozeInstant(customValue)) {
      setError(t.snooze.invalidCustom)
      return
    }
    void confirm(new Date(customValue).toISOString())
  }

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div className="sheet" onClick={(event) => event.stopPropagation()}>
        <h2>{t.snooze.title(tasks.length)}</h2>
        <p className="screen-subtitle">{tasks.map((task) => task.title).join(', ')}</p>

        <div className="preset-row">
          {SNOOZE_PRESETS.map((preset) => (
            <button
              key={preset.minutes}
              type="button"
              className="preset"
              disabled={busy}
              onClick={() => void confirm(snoozeUntilInMinutes(preset.minutes))}
            >
              {t.snooze.presets[preset.labelKey]}
            </button>
          ))}
        </div>

        {customOpen ? (
          <form className="field" onSubmit={chooseCustom}>
            <label>
              <span>{t.snooze.custom}</span>
              <input
                type="datetime-local"
                value={customValue}
                min={toDatetimeLocalValue(new Date(Date.now() + 60_000))}
                onChange={(event) => setCustomValue(event.target.value)}
              />
            </label>
            <div className="sheet-actions">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {t.snooze.setCustom}
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setCustomOpen(true)}>
            <ClockIcon size={18} /> {t.snooze.custom}
          </button>
        )}

        {error && <p className="error-text">{error}</p>}

        <div className="sheet-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            {t.common.cancel}
          </button>
        </div>
      </div>
    </div>
  )
}
