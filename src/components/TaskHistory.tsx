import { useEffect, useState } from 'react'
import * as api from '../lib/api'
import { describeInterval, describeWeeklyDays, formatDate, formatSnoozeUntil, formatTime, personLabel, relativeDay } from '../lib/format'
import { googleCalendarUrl } from '../lib/googleCalendar'
import { addDays, currentOccurrence, formatTimeIn, todayIn } from '../lib/taskDue'
import { median, summarizeCadence, SUGGESTION_WINDOW_DAYS } from '../lib/cadence'
import { buildTimeline, type TimelineEntry } from '../lib/taskTimeline'
import { useI18n } from '../lib/i18n'
import { useDialog } from '../lib/useDialog'
import { useApp } from '../state/AppState'
import type { Task, TaskHistoryEntry, TaskSkipEntry } from '../lib/types'
import { CalendarIcon, CheckIcon, PencilIcon, SkipIcon, TodayIcon, XIcon } from './Icons'
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
  const { people, session, today, profile, reminderOverrides, patchReminderOverride, pauses, isPaused } = useApp()
  const { t, language } = useI18n()
  const { titleId, dialogProps } = useDialog<HTMLDivElement>(onClose)
  const toast = useToast()
  const selfId = session?.user.id ?? null
  const [entries, setEntries] = useState<TaskHistoryEntry[] | null>(null)
  const [skipEntries, setSkipEntries] = useState<TaskSkipEntry[] | null>(null)
  const [editingReminder, setEditingReminder] = useState(false)
  const [historyLimit, setHistoryLimit] = useState(50)
  const timezone = profile?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const myOverride = reminderOverrides.get(task.id) ?? null

  // A personal override only makes sense for a wall-clock reminder time - an
  // ordinary task's reminder_hour/minute, or a time-limited task's own daily
  // cadence (reminder_policy.dailyHour/dailyMinute). start_only and interval
  // are a fixed offset from the window's own opening instant, the same for
  // everyone, with no time-of-day to personalize.
  const isDailyTimeLimited = task.task_type === 'time_limited' && task.reminder_policy?.mode === 'daily'
  const showReminderRow = task.task_type !== 'time_limited' || isDailyTimeLimited
  const defaultReminderHour = isDailyTimeLimited ? (task.reminder_policy?.dailyHour ?? 0) : task.reminder_hour
  const defaultReminderMinute = isDailyTimeLimited ? (task.reminder_policy?.dailyMinute ?? 0) : task.reminder_minute

  useEffect(() => {
    let cancelled = false
    Promise.all([api.fetchHistory(task.id, historyLimit), api.fetchSkipHistory(task.id, historyLimit)])
      .then(([rows, skipRows]) => {
        if (cancelled) return
        setEntries(rows)
        setSkipEntries(skipRows)
      })
      .catch((cause) => {
        toast.showError(cause)
        if (!cancelled) {
          setEntries([])
          setSkipEntries([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [task.id, toast, historyLimit])

  // Not the raw due_date: a recurring task a full cycle or more overdue is on
  // a later occurrence than the one it was first due on - the same one its
  // card's badge counts from.
  const occurrence = currentOccurrence(task, today)

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

  // Every cycle, newest first: done (by whom, when), skipped (by whom,
  // when), missed, and vacations - see buildTimeline().
  const timeline =
    entries === null || skipEntries === null
      ? null
      : buildTimeline(task, entries, skipEntries, pauses, today, isPaused(task))
  const mayHaveMore = (entries?.length ?? 0) >= historyLimit || (skipEntries?.length ?? 0) >= historyLimit

  // This task's own rhythm over the last 60 days, from the same rows.
  const cadenceLine = (() => {
    if (task.task_type !== 'recurring' || entries === null || skipEntries === null) return null
    const counts = summarizeCadence(
      [task],
      entries.map((row) => ({ ...row, task_id: task.id })),
      skipEntries.map((row) => ({ ...row, task_id: task.id })),
      today,
      addDays(today, -SUGGESTION_WINDOW_DAYS),
      () => isPaused(task),
    ).byTask.get(task.id)
    if (!counts) return null
    const parts = [
      counts.early && t.history.cadence.early(counts.early),
      counts.onTime && t.history.cadence.onTime(counts.onTime),
      counts.late && t.history.cadence.late(counts.late),
      counts.skipped && t.history.cadence.skipped(counts.skipped),
      counts.missed && t.history.cadence.missed(counts.missed),
    ].filter(Boolean) as string[]
    const gap = task.recurrence_mode === 'interval' && counts.gaps.length >= 2 ? median(counts.gaps) : null
    if (gap !== null) parts.push(t.history.cadence.actual(describeInterval(Math.max(1, Math.round(gap)), language)))
    return parts.length ? `${t.history.cadence.prefix} ${parts.join(' · ')}` : null
  })()

  function who(userId: string): { you: boolean; name: string } {
    const label = personLabel(userId, people, selfId, language)
    return label?.kind === 'other' ? { you: false, name: label.name ?? t.task.someoneElse } : { you: true, name: '' }
  }

  /** The time it was logged - only when that was on the day it is listed
   *  under; a completion backdated to yesterday was not done at the time
   *  someone tapped it in. */
  function loggedAt(createdAt: string, date: string): string | null {
    const at = new Date(createdAt)
    if (todayIn(timezone, at) !== date) return null
    return formatTimeIn(timezone, createdAt)
  }

  function describe(entry: TimelineEntry): string {
    switch (entry.kind) {
      case 'done': {
        const main =
          entry.people > 1
            ? t.history.entryGroup(entry.points, entry.people)
            : (() => {
                const person = who(entry.userId)
                return t.history.entry(person.you ? t.task.completedByYou : t.task.completedBy(person.name), entry.points)
              })()
        const time = loggedAt(entry.createdAt, entry.date)
        return time ? `${main} · ${time}` : main
      }
      case 'skipped': {
        const person = who(entry.userId)
        const main = person.you ? t.history.skippedByYou : t.history.skippedBy(person.name)
        const time = loggedAt(entry.createdAt, entry.date)
        return time ? `${main} · ${time}` : main
      }
      case 'missed':
        return t.history.missed
      case 'vacation': {
        const main = entry.userId === null ? t.history.vacationSpace : t.history.vacationPerson(who(entry.userId).you ? t.space.you : who(entry.userId).name)
        return `${main} · ${entry.until ? t.history.vacationUntil(formatDate(entry.until, language)) : t.history.vacationOngoing}`
      }
    }
  }

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
      <div className="sheet" {...dialogProps} onClick={(event) => event.stopPropagation()}>
        <h2 id={titleId}>{task.title}</h2>

        {task.description && <p className="task-detail-description">{task.description}</p>}

        <dl className="task-detail-grid">
          <dt>{t.history.detail.points}</dt>
          <dd>{t.task.pointsBadge(task.points)}</dd>

          {task.task_type !== 'time_limited' && !task.is_done && (
            <>
              <dt>
                {task.task_type !== 'recurring'
                  ? t.history.detail.dueDate
                  : occurrence <= today
                    ? t.history.detail.currentOccurrence
                    : t.history.detail.nextOccurrence}
              </dt>
              <dd>
                {formatDate(occurrence, language)} · {relativeDay(occurrence, today, language)}
              </dd>
            </>
          )}

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
            </>
          )}

          {showReminderRow && (
            <>
              <dt>{t.history.detail.reminder}</dt>
              <dd className="task-detail-reminder">
                <span>
                  {myOverride
                    ? t.history.detail.reminderPersonal(formatTime(myOverride.hour, myOverride.minute))
                    : formatTime(defaultReminderHour, defaultReminderMinute)}
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

        {cadenceLine && <p className="muted small cadence-summary">{cadenceLine}</p>}

        {timeline === null ? (
          <p className="muted">{t.common.loading}</p>
        ) : timeline.length === 0 ? (
          <p className="muted">{t.history.empty}</p>
        ) : (
          <ul className="history-list">
            {timeline.map((entry) => (
              <li key={entry.key} className={`history-row history-row-${entry.kind}`}>
                <span className="history-date">
                  <span className="history-mark" aria-hidden="true">
                    {entry.kind === 'done' ? (
                      <CheckIcon size={14} />
                    ) : entry.kind === 'skipped' ? (
                      <SkipIcon size={14} />
                    ) : entry.kind === 'missed' ? (
                      <XIcon size={14} />
                    ) : (
                      <TodayIcon size={14} />
                    )}
                  </span>
                  {formatDate(entry.date, language)}
                </span>
                <span className="history-who">{describe(entry)}</span>
              </li>
            ))}
          </ul>
        )}
        {mayHaveMore && (
          <button type="button" className="link-button" onClick={() => setHistoryLimit((n) => n + 50)}>
            {t.history.loadMore}
          </button>
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
        initialHour={myOverride?.hour ?? defaultReminderHour}
        initialMinute={myOverride?.minute ?? defaultReminderMinute}
        hasOverride={myOverride !== null}
        onSave={saveReminderOverride}
        onReset={resetReminderOverride}
        onClose={() => setEditingReminder(false)}
      />
    )}
    </>
  )
}
