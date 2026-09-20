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

export type TaskType = 'one_time' | 'recurring' | 'time_limited'
export type RecurrenceMode = 'interval' | 'weekly_days'
export type EndCondition = 'never' | 'after_count' | 'on_date'

export type DueStatus =
  | 'completed_today' // done today; stays visible until tomorrow
  | 'done' // a one-time task, or a recurring task past its end condition - finished for good
  | 'late' // should have been done on an earlier day, and stays late (no cutoff) until completed or deleted
  | 'due' // due today
  | 'upcoming' // not yet
  | 'scheduled' // a time-limited task, before its window opens
  | 'active' // a time-limited task, inside its window right now
  | 'expired' // a time-limited task whose window closed without being completed
  | 'cancelled' // a time-limited task the person called off themselves

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
  /** Only meaningful for task_type 'time_limited'. */
  starts_at: string | null
  expires_at: string | null
  cancelled_at: string | null
  expired_at: string | null
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

/** "HH:MM" for an ISO instant, in the given IANA timezone - used to describe
 *  a time-limited task's own window rather than a fixed daily reminder_hour. */
export function formatTimeIn(timezone: string, iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso))
  } catch {
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(
      new Date(iso),
    )
  }
}

/** The recurrence fields cycleLateness() actually needs - a structural
 *  subset of DueTask, so a caller with just these four fields (a past
 *  completion's own task record, say) can use it without assembling a full
 *  DueTask it does not otherwise have. */
export interface CyclicTask {
  task_type: TaskType
  recurrence_mode: RecurrenceMode | null
  interval_days: number | null
  weekly_days: number[] | null
}

/**
 * Wraps an already-overdue gap to the most recently passed point on the
 * task's own repeating schedule, rather than the raw distance from the
 * original due date.
 *
 * For most chores here, being a little late on any one occurrence is not
 * itself the problem - what matters is whether it is still outstanding once
 * its own next occurrence would have come around. So once a full cycle goes
 * by unaddressed, the count resets and starts again from that point: two and
 * a half cycles late reads as "half a cycle late", not as an ever-growing
 * tally of every cycle ever missed. A one-time task, or a recurring one
 * missing the fields its own mode needs, has no such repeating grid, so the
 * raw gap passes through unchanged.
 */
export function cycleLateness(task: CyclicTask, dueDate: string, rawDaysLate: number): number {
  if (rawDaysLate <= 0 || task.task_type !== 'recurring') return rawDaysLate

  if (task.recurrence_mode === 'interval' && task.interval_days) {
    return rawDaysLate % task.interval_days
  }

  if (task.recurrence_mode === 'weekly_days' && task.weekly_days?.length) {
    // Walks the grid the task would have kept had it never been touched -
    // one nextWeeklyDate() step at a time, since the gaps between chosen
    // weekdays are not necessarily even - until the next step would
    // overshoot `to`, leaving `gridPoint` as the most recent one not after it.
    const to = addDays(dueDate, rawDaysLate)
    let gridPoint = dueDate
    let next = nextWeeklyDate(task.weekly_days, gridPoint)
    while (daysBetween(next, to) >= 0) {
      gridPoint = next
      next = nextWeeklyDate(task.weekly_days, gridPoint)
    }
    return daysBetween(gridPoint, to)
  }

  return rawDaysLate
}

export function classify(task: DueTask, today: string, now: Date = new Date()): DueInfo {
  if (task.task_type === 'time_limited') return classifyTimeLimited(task, today, now)

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

  const rawLate = daysBetween(task.due_date, today)

  if (rawLate > 0) {
    // No cutoff: an overdue task keeps nagging every day until it is done or
    // deleted - unlike a plant, a chore does not become fine to ignore. But
    // the count itself wraps to the current cycle - see cycleLateness().
    const late = cycleLateness(task, task.due_date, rawLate)
    if (late === 0) return { status: 'due', daysLate: 0, notifiable: true }
    return { status: 'late', daysLate: late, notifiable: true }
  }
  if (rawLate === 0) {
    return { status: 'due', daysLate: 0, notifiable: true }
  }
  return { status: 'upcoming', daysLate: rawLate, notifiable: false }
}

/**
 * A time-limited task's status turns on clock time, not the calendar day -
 * "active" can start and end within the same afternoon - so this reads
 * starts_at/expires_at against `now` directly instead of going through
 * daysBetween(). Terminal states are told apart by which timestamp got set,
 * the same way last_completed_date already tells a real completion from an
 * untouched task everywhere else in this file.
 */
function classifyTimeLimited(task: DueTask, today: string, now: Date): DueInfo {
  if (task.is_done) {
    if (task.cancelled_at) return { status: 'cancelled', daysLate: 0, notifiable: false }
    if (task.expired_at) return { status: 'expired', daysLate: 0, notifiable: false }
    if (task.last_completed_date === today) {
      return { status: 'completed_today', daysLate: 0, notifiable: false }
    }
    return { status: 'done', daysLate: 0, notifiable: false }
  }

  const nowMs = now.getTime()
  const expiresMs = task.expires_at ? new Date(task.expires_at).getTime() : Infinity
  const startsMs = task.starts_at ? new Date(task.starts_at).getTime() : -Infinity

  // The window can close well before the periodic sweep flips is_done - the
  // UI should not keep calling it "active" for up to 15 more minutes just
  // because the database row has not caught up yet.
  if (nowMs >= expiresMs) return { status: 'expired', daysLate: 0, notifiable: false }
  if (nowMs < startsMs) return { status: 'scheduled', daysLate: 0, notifiable: false }
  return { status: 'active', daysLate: 0, notifiable: true }
}

/** Rank for list ordering: overdue tasks first, finished ones last. */
const STATUS_ORDER: Record<DueStatus, number> = {
  active: -1,
  late: 0,
  due: 1,
  completed_today: 2,
  upcoming: 3,
  scheduled: 3,
  done: 4,
  expired: 4,
  cancelled: 4,
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
  if (task.task_type === 'one_time' || task.task_type === 'time_limited') {
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
