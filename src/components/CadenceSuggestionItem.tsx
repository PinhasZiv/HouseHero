import * as api from '../lib/api'
import { planIntervalChange, type CadenceSuggestion } from '../lib/cadence'
import { describeInterval } from '../lib/format'
import { useI18n } from '../lib/i18n'
import type { Task } from '../lib/types'
import { useApp } from '../state/AppState'
import { useToast } from './Toast'

const DISMISSED_KEY = 'househero.cadence.dismissed'
/** How long "not now" keeps a suggestion away. */
export const DISMISS_DAYS = 30

/** When each suggestion was last put off, by task - shared by the Stats
 *  screen and the weekly report, so "not now" in one holds in the other. */
export function readDismissed(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}

export function writeDismissed(next: Record<string, string>) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(next))
  } catch {
    // Storage blocked; it just comes back next time.
  }
}

/** One interval change on offer: why, and a button that makes it. */
export function CadenceSuggestionItem({
  task,
  suggestion,
  onDismiss,
}: {
  task: Task
  suggestion: CadenceSuggestion
  onDismiss: () => void
}) {
  const { today, patchTask } = useApp()
  const { t, language } = useI18n()
  const toast = useToast()

  async function apply() {
    const plan = planIntervalChange(task, suggestion.suggested, suggestion.current, today)
    try {
      patchTask(await api.updateTaskInterval(task.id, plan.interval_days, plan.due_date))
      toast.show(t.stats.intervalChanged(task.title, describeInterval(plan.interval_days, language)))
    } catch (cause) {
      toast.showError(cause)
    }
  }

  return (
    <li className="suggestion">
      <strong>{task.title}</strong>
      <p className="muted small">
        {suggestion.direction === 'shorter'
          ? t.stats.suggestShorter(
              describeInterval(Math.max(1, Math.round(suggestion.actualGap ?? suggestion.suggested)), language),
              describeInterval(suggestion.current, language),
            )
          : t.stats.suggestLonger(suggestion.dropped, suggestion.cycles, describeInterval(suggestion.current, language))}
      </p>
      <div className="suggestion-actions">
        <button type="button" className="btn btn-primary btn-small" onClick={() => void apply()}>
          {t.stats.applySuggestion(describeInterval(suggestion.suggested, language))}
        </button>
        <button type="button" className="btn btn-ghost btn-small" onClick={onDismiss}>
          {t.stats.notNow}
        </button>
      </div>
    </li>
  )
}
