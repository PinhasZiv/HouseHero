// The task-scheduling rules, in one place.
//
// This file is the single source of truth for "is this task due, how late is
// it, and what happens the moment it gets completed". It is imported by the
// React app (to render the lists) and by the reminder Edge Function (to decide
// who gets a push), so the badge on screen and the text in the notification
// can never disagree.
//
// Everything here is a pure function over `YYYY-MM-DD` strings. No Date
// arithmetic across timezones, no clock reads - the caller decides what
// "today" is and passes it in.

export type TaskType = 'one_time' | 'recurring'
export type RecurrenceMode = 'interval' | 'weekly_days'
export type EndCondition = 'never' | 'after_count' | 'on_date'

export type DueStatus =
  | 'completed_today' // done today; stays visible until tomorrow
  | 'done' // a one-time task, or a recurring task past its end condition - finished for good
  | 'late' // should have been done on an earlier day, and stays late (no cutoff) until completed or deleted
  | 'due' // due today
  | 'upcoming' // not yet

export interface DueTask {
  task_type: TaskType
  recurrence_mode: RecurrenceMode | null
  interval_days: number | null
  /** 0 (Sunday) through 6 (Saturday). */
  weekly_days: number[] | null
  end_condition: EndCondition
  end_after_count: number | null
  end_date: string | null
  occurrences_completed: number
  due_date: string
  last_completed_date: string | null
  is_done: boolean
}

export interface DueInfo {
  status: DueStatus
  /** 0 when due today, 1+ when overdue, negative for upcoming. */
  daysLate: number
  /** Whether this task should still produce a notification right now. */
  notifiable: boolean
}

const MS_PER_DAY = 86_400_000

/** Parses `YYYY-MM-DD` as a UTC midnight instant, purely for day arithmetic. */
function toUtcMillis(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/** Whole days from `from` to `to`. Both are `YYYY-MM-DD`. */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtcMillis(to) - toUtcMillis(from)) / MS_PER_DAY)
}

export function addDays(isoDate: string, days: number): string {
  return formatDate(new Date(toUtcMillis(isoDate) + days * MS_PER_DAY))
}

/** `YYYY-MM-DD` from a Date's UTC fields. */
function formatDate(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 0 (Sunday) through 6 (Saturday), for a `YYYY-MM-DD` date. */
export function dayOfWeek(isoDate: string): number {
  return new Date(toUtcMillis(isoDate)).getUTCDay()
}

/** Today's date in the given IANA timezone, as `YYYY-MM-DD`. */
export function todayIn(timezone: string, now: Date = new Date()): string {
  try {
    // en-CA formats as YYYY-MM-DD, which is exactly the shape we store.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now)
  } catch {
    return new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now)
  }
}

/** Minutes since local midnight in the given timezone. */
export function minutesOfDayIn(timezone: string, now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
  // Some locales render midnight as 24; normalise it back to 0.
  return (hour % 24) * 60 + minute
}

export function classify(task: DueTask, today: string): DueInfo {
  if (task.is_done) {
    // Finished for good (one-time task done, or a recurring task that hit its
    // end condition) - but the very evening it happened it still shows as a
    // fresh completion rather than just vanishing.
    if (task.last_completed_date === today) {
      return { status: 'completed_today', daysLate: 0, notifiable: false }
    }
    return { status: 'done', daysLate: 0, notifiable: false }
  }

  // A recurring task completed today stays visible for the rest of the day,
  // marked done, so a second person opening the app sees it was handled.
  if (task.last_completed_date === today) {
    return { status: 'completed_today', daysLate: 0, notifiable: false }
  }

  const late = daysBetween(task.due_date, today)

  if (late > 0) {
    // No cutoff: an overdue task keeps nagging every day until it is done or
    // deleted - unlike a plant, a chore does not become fine to ignore.
    return { status: 'late', daysLate: late, notifiable: true }
  }
  if (late === 0) {
    return { status: 'due', daysLate: 0, notifiable: true }
  }
  return { status: 'upcoming', daysLate: late, notifiable: false }
}

/** Rank for list ordering: overdue tasks first, finished ones last. */
const STATUS_ORDER: Record<DueStatus, number> = {
  late: 0,
  due: 1,
  completed_today: 2,
  upcoming: 3,
  done: 4,
}

/** Tasks that belong on the "due today" list, worst-overdue first. */
export function actionable<T extends DueTask>(tasks: T[], today: string): T[] {
  return tasks
    .map((task) => ({ task, info: classify(task, today) }))
    .filter(({ info }) => info.status !== 'upcoming' && info.status !== 'done')
    .sort((a, b) => {
      const byStatus = STATUS_ORDER[a.info.status] - STATUS_ORDER[b.info.status]
      return byStatus !== 0 ? byStatus : b.info.daysLate - a.info.daysLate
    })
    .map(({ task }) => task)
}

/** Tasks that should trigger a notification right now. */
export function notifiable<T extends DueTask>(tasks: T[], today: string): T[] {
  return tasks.filter((t) => classify(t, today).notifiable)
}

/** The next date, strictly after `from`, whose weekday is in `weeklyDays`. */
export function nextWeeklyDate(weeklyDays: number[], from: string): string {
  for (let offset = 1; offset <= 7; offset++) {
    const candidate = addDays(from, offset)
    if (weeklyDays.includes(dayOfWeek(candidate))) return candidate
  }
  // Unreachable when weeklyDays is non-empty (checked by the DB constraint),
  // but keeps this function total rather than possibly-undefined.
  return addDays(from, 7)
}

export interface CompletionOutcome {
  /** null when the task is now finished for good - nothing more to schedule. */
  nextDueDate: string | null
  occurrencesCompleted: number
  finished: boolean
}

/**
 * Works out what happens to a task's schedule the moment it is completed.
 * Pure and total: does not touch the database, just decides the next state.
 */
export function planCompletion(task: DueTask, completedOn: string): CompletionOutcome {
  if (task.task_type === 'one_time') {
    return { nextDueDate: null, occurrencesCompleted: task.occurrences_completed + 1, finished: true }
  }

  const occurrencesCompleted = task.occurrences_completed + 1

  const candidate =
    task.recurrence_mode === 'weekly_days'
      ? nextWeeklyDate(task.weekly_days ?? [], completedOn)
      : addDays(completedOn, task.interval_days ?? 1)

  if (task.end_condition === 'after_count' && occurrencesCompleted >= (task.end_after_count ?? Infinity)) {
    return { nextDueDate: null, occurrencesCompleted, finished: true }
  }
  if (task.end_condition === 'on_date' && task.end_date && candidate > task.end_date) {
    return { nextDueDate: null, occurrencesCompleted, finished: true }
  }

  return { nextDueDate: candidate, occurrencesCompleted, finished: false }
}
