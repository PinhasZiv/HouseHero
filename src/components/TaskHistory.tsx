import { useEffect, useState } from 'react'
import * as api from '../lib/api'
import { formatDate, personLabel } from '../lib/format'
import { useI18n } from '../lib/i18n'
import { useApp } from '../state/AppState'
import type { Task, TaskHistoryEntry } from '../lib/types'
import { useToast } from './Toast'

interface TaskHistoryProps {
  task: Task
  onClose: () => void
}

/**
 * Who completed this task and when - including completions from previous
 * days, which are no longer visible on the card itself. Undoing a completion
 * removes its row here too, the same way it restores everything else about
 * that completion as if it had not happened.
 */
export function TaskHistory({ task, onClose }: TaskHistoryProps) {
  const { people, session } = useApp()
  const { t, language } = useI18n()
  const toast = useToast()
  const selfId = session?.user.id ?? null
  const [entries, setEntries] = useState<TaskHistoryEntry[] | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .fetchHistory(task.id)
      .then((rows) => {
        if (!cancelled) setEntries(rows)
      })
      .catch((cause) => {
        toast.showError(cause)
        if (!cancelled) setEntries([])
      })
    return () => {
      cancelled = true
    }
  }, [task.id, toast])

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div className="sheet" onClick={(event) => event.stopPropagation()}>
        <h2>{t.history.title(task.title)}</h2>

        {entries === null ? (
          <p className="muted">{t.common.loading}</p>
        ) : entries.length === 0 ? (
          <p className="muted">{t.history.empty}</p>
        ) : (
          <ul className="history-list">
            {entries.map((entry) => {
              const who = personLabel(entry.user_id, people, selfId, language)
              const whoText =
                who?.kind === 'other'
                  ? t.task.completedBy(who.name ?? t.task.someoneElse)
                  : t.task.completedByYou
              return (
                <li key={entry.id} className="history-row">
                  <span className="history-date">{formatDate(entry.completed_on, language)}</span>
                  <span className="history-who">{t.history.entry(whoText, entry.points_awarded)}</span>
                </li>
              )
            })}
          </ul>
        )}

        <div className="sheet-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t.common.close}
          </button>
        </div>
      </div>
    </div>
  )
}
