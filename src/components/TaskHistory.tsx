import { useEffect, useState } from 'react'
import * as api from '../lib/api'
import { describeInterval, describeWeeklyDays, formatDate, formatTime, personLabel } from '../lib/format'
import { googleCalendarUrl } from '../lib/googleCalendar'
import { useI18n } from '../lib/i18n'
import { useApp } from '../state/AppState'
import type { Task, TaskHistoryEntry } from '../lib/types'
import { CalendarIcon } from './Icons'
import { useToast } from './Toast'

interface TaskHistoryProps {
  task: Task
  onClose: () => void
}

/**
 * Tapping a task card opens this: everything about the task that does not
 * fit on the compact card - the description, its full schedule, who it is
 * assigned to - plus its completion history, including days no longer
 * visible on the card itself. This is the only place to see those details
 * without going into the edit form, which most people opening this just
 * want to look at, not change.
 *
 * Undoing a completion removes its row here too, the same way it restores
 * everything else about that completion as if it had not happened.
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

  const scheduleLabel =
    task.task_type === 'one_time'
      ? t.history.detail.oneTime
      : task.recurrence_mode === 'weekly_days'
        ? describeWeeklyDays(task.weekly_days ?? [], language)
        : describeInterval(task.interval_days ?? 1, language)

  const assignedLabel = !task.assigned_to
    ? t.common.everyone
    : task.assigned_to === selfId
      ? t.task.assignedToYou
      : t.task.assignedTo(
          people.get(task.assigned_to)?.display_name || people.get(task.assigned_to)?.email || t.task.someoneElse,
        )

  // A "together" completion inserts one row per space member, all sharing
  // completion_group - collapse those into a single entry rather than
  // listing the same moment once per person.
  const seenGroups = new Set<string>()
  const displayEntries = (entries ?? [])
    .filter((entry) => {
      if (!entry.completion_group) return true
      if (seenGroups.has(entry.completion_group)) return false
      seenGroups.add(entry.completion_group)
      return true
    })
    .map((entry) => {
      const label = entry.completion_group
        ? t.history.entryGroup(
            entry.points_awarded,
            (entries ?? []).filter((row) => row.completion_group === entry.completion_group).length,
          )
        : (() => {
            const who = personLabel(entry.user_id, people, selfId, language)
            const whoText =
              who?.kind === 'other' ? t.task.completedBy(who.name ?? t.task.someoneElse) : t.task.completedByYou
            return t.history.entry(whoText, entry.points_awarded)
          })()
      return { key: entry.id, date: entry.completed_on, label }
    })

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div className="sheet" onClick={(event) => event.stopPropagation()}>
        <h2>{task.title}</h2>

        {task.description && <p className="task-detail-description">{task.description}</p>}

        <dl className="task-detail-grid">
          <dt>{t.history.detail.points}</dt>
          <dd>{t.task.pointsBadge(task.points)}</dd>

          <dt>{t.history.detail.schedule}</dt>
          <dd>{scheduleLabel}</dd>

          <dt>{t.history.detail.reminder}</dt>
          <dd>{formatTime(task.reminder_hour, task.reminder_minute)}</dd>

          <dt>{t.history.detail.assignedTo}</dt>
          <dd>{assignedLabel}</dd>

          {task.task_type === 'recurring' && task.end_condition !== 'never' && (
            <>
              <dt>{t.history.detail.ends}</dt>
              <dd>
                {task.end_condition === 'after_count' && task.end_after_count != null
                  ? t.history.detail.endsAfterCount(task.end_after_count)
                  : task.end_date
                    ? formatDate(task.end_date, language)
                    : null}
              </dd>
            </>
          )}
        </dl>

        <a
          className="btn btn-ghost btn-small"
          href={googleCalendarUrl(task)}
          target="_blank"
          rel="noopener noreferrer"
        >
          <CalendarIcon size={16} />
          {t.history.addToGoogleCalendar}
        </a>

        <h3 className="group-title">{t.history.sectionTitle}</h3>

        {entries === null ? (
          <p className="muted">{t.common.loading}</p>
        ) : entries.length === 0 ? (
          <p className="muted">{t.history.empty}</p>
        ) : (
          <ul className="history-list">
            {displayEntries.map((entry) => (
              <li key={entry.key} className="history-row">
                <span className="history-date">{formatDate(entry.date, language)}</span>
                <span className="history-who">{entry.label}</span>
              </li>
            ))}
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
