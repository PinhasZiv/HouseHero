import type { Task } from './types'

// Google Tasks' own API cannot do what this needs: no recurrence at all, no
// reminder/due time (due only ever holds a date), and even a bare
// title+notes task requires a full OAuth flow - there is no unauthenticated
// "quick add" link the way Calendar has. Calendar's template URL, by
// contrast, needs no auth and covers everything a task actually carries:
// title, description, a real due date+time, and true recurrence via RRULE.

const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

/** Wall-clock arithmetic only - the UTC methods are just a calculator here,
 *  the same trick taskDue.ts uses, so "add 30 minutes" can't roll into the
 *  wrong local day near a real UTC boundary. */
function wallClockDate(isoDate: string, hour: number, minute: number): Date {
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day, hour, minute))
}

function formatForGoogle(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}00`
  )
}

/** null for a one-time task - Calendar treats a plain event as non-repeating
 *  when the URL carries no recur param at all. */
function buildRecurrenceRule(task: Task): string | null {
  if (task.task_type !== 'recurring') return null

  const parts: string[] = []
  if (task.recurrence_mode === 'weekly_days') {
    const days = (task.weekly_days ?? []).map((day) => WEEKDAY_CODES[day]).join(',')
    parts.push('FREQ=WEEKLY', `BYDAY=${days}`)
  } else {
    parts.push('FREQ=DAILY', `INTERVAL=${task.interval_days ?? 1}`)
  }

  if (task.end_condition === 'after_count' && task.end_after_count != null) {
    // COUNT is remaining occurrences from *this* event onward, not the
    // task's lifetime total - it has already completed occurrences_completed
    // of them.
    const remaining = Math.max(1, task.end_after_count - task.occurrences_completed)
    parts.push(`COUNT=${remaining}`)
  } else if (task.end_condition === 'on_date' && task.end_date) {
    parts.push(`UNTIL=${task.end_date.replace(/-/g, '')}T235959Z`)
  }

  return `RRULE:${parts.join(';')}`
}

/**
 * A link that opens Google Calendar's "add event" screen pre-filled from a
 * task - no OAuth, no server round-trip, just a URL. The event's own default
 * reminder stands in for the task's reminder time, since that time is now
 * the event's start time rather than a separate field.
 */
export function googleCalendarUrl(task: Task): string {
  // A time-limited task already carries a real window - use it as-is rather
  // than the 30-minute placeholder every other task type gets from its
  // single due date + reminder time.
  const start =
    task.task_type === 'time_limited' && task.starts_at
      ? new Date(task.starts_at)
      : wallClockDate(task.due_date, task.reminder_hour, task.reminder_minute)
  const end =
    task.task_type === 'time_limited' && task.expires_at
      ? new Date(task.expires_at)
      : new Date(start.getTime() + 30 * 60_000)

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: task.title,
    dates: `${formatForGoogle(start)}/${formatForGoogle(end)}`,
  })
  if (task.description) params.set('details', task.description)
  const recur = buildRecurrenceRule(task)
  if (recur) params.set('recur', recur)

  return `https://calendar.google.com/calendar/render?${params.toString()}`
}
