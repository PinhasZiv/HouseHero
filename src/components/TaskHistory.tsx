import { useEffect, useState } from 'react'
import * as api from '../lib/api'
import { describeInterval, describeWeeklyDays, formatDate, formatSnoozeUntil, formatTime, personLabel } from '../lib/format'
import { googleCalendarUrl } from '../lib/googleCalendar'
import { useI18n } from '../lib/i18n'
import { useApp } from '../state/AppState'
import type { Task, TaskHistoryEntry } from '../lib/types'
import { CalendarIcon, PencilIcon } from './Icons'
import { ReminderOverrideSheet } from './ReminderOverrideSheet'
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
  const { people, session, today, reminderOverrides, patchReminderOverride } = useApp()
  const { t, language } = useI18n()
  const toast = useToast()
  const selfId = session?.user.id ?? null
  const [entries, setEntries] = useState<TaskHistoryEntry[] | null>(null)
  const [editingReminder, setEditingReminder] = useState(false)
  const myOverride = reminderOverrides.get(task.id) ?? null

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
      : task.task_type === 'time_limited'
        ? null
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

  async function saveReminderOverride(hour: number, minute: number) {
    if (!selfId) return
    await api.setReminderOverride(task.id, selfId, hour, minute)
    patchReminderOverride(task.id, { hour, minute })
    setEditingReminder(false)
    toast.show(t.reminderOverride.saved)
  }

  async function resetReminderOverride() {
    if (!selfId) return
    await api.clearReminderOverride(task.id, selfId)
    patchReminderOverride(task.id, null)
    setEditingReminder(false)
    toast.show(t.reminderOverride.resetDone)
  }

  return (
    <>
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div className="sheet" onClick={(event) => event.stopPropagation()}>
        <h2>{task.title}</h2>

        {task.description && <p className="task-detail-description">{task.description}</p>}

        <dl className="task-detail-grid">
          <dt>{t.history.detail.points}</dt>
          <dd>{t.task.pointsBadge(task.points)}</dd>

          {task.task_type === 'time_limited' ? (
            <>
              <dt>{t.taskForm.windowStart}</dt>
              <dd>{task.starts_at ? formatSnoozeUntil(task.starts_at, today, language) : null}</dd>

              <dt>{t.taskForm.windowEnd}</dt>
              <dd>{task.expires_at ? formatSnoozeUntil(task.expires_at, today, language) : null}</dd>
            </>
          ) : (
            <>
              <dt>{t.history.detail.schedule}</dt>
              <dd>{scheduleLabel}</dd>

              <dt>{t.history.detail.reminder}</dt>
              <dd className="task-detail-reminder">
                <span>
                  {myOverride
                    ? t.history.detail.reminderPersonal(formatTime(myOverride.hour, myOverride.minute))
                    : formatTime(task.reminder_hour, task.reminder_minute)}
                </span>
                {selfId && (
                  <button
                    type="button"
                    className="icon-button icon-button-small"
                    onClick={() => setEditingReminder(true)}
                    aria-label={t.history.detail.reminderEditAria(task.title)}
                  >
                    <PencilIcon size={14} />
                  </button>
                )}
              </dd>
            </>
          )}

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

    {editingReminder && (
      <ReminderOverrideSheet
        taskTitle={task.title}
        initialHour={myOverride?.hour ?? task.reminder_hour}
        initialMinute={myOverride?.minute ?? task.reminder_minute}
        hasOverride={myOverride !== null}
        onSave={saveReminderOverride}
        onReset={resetReminderOverride}
        onClose={() => setEditingReminder(false)}
      />
    )}
    </>
  )
}
