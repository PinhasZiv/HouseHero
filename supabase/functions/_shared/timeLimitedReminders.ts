// Deciding which reminder "slots" of a time-limited task are due right now -
// kept separate from send-reminders/index.ts (Deno-only database access) so
// this can be unit tested the same way taskDue.ts and snoozeResend.ts already
// are.
//
// A time-limited task can remind more than once a day, so it cannot share
// notification_log's one-slot-per-calendar-day key. Each slot here is instead
// identified by its own exact instant, which is what
// time_limited_reminder_log dedups on.

import { daysBetween, minutesOfDayIn, todayIn } from './taskDue.ts'

export type ReminderPolicyMode = 'none' | 'start_only' | 'interval' | 'daily'

export interface ReminderPolicy {
  mode: ReminderPolicyMode
  /** Used when mode is 'interval' - a rolling cadence anchored to startsAt,
   *  regardless of whether the form showed it as minutes or hours. */
  intervalMinutes: number | null
  /** Used when mode is 'daily' - a wall-clock cadence, so (unlike the other
   *  modes) it needs the recipient's own timezone to evaluate. */
  dailyIntervalDays: number | null
  dailyHour: number | null
  dailyMinute: number | null
  finalReminderMinutesBeforeExpiry: number | null
}

export interface TimeLimitedTask {
  id: string
  startsAt: string
  expiresAt: string
  reminderPolicy: ReminderPolicy | null
}

export interface ReminderSlot {
  taskId: string
  /** ISO instant - the dedup key in time_limited_reminder_log. */
  slot: string
}

const MS_PER_MINUTE = 60_000

/**
 * Every reminder slot for one task that has just come due, within a trailing
 * window - the same tolerance idea as send-reminders' WINDOW_MINUTES, just
 * keyed by an exact instant instead of a calendar day, since more than one
 * slot can fall on the same day.
 *
 * `timezone` only matters for `mode: 'daily'`: minutes/hours cadences are a
 * fixed rolling offset from startsAt (the same instant for everyone), but a
 * daily cadence is defined by a local wall-clock time, so it has to be
 * evaluated per recipient.
 */
export function dueReminderSlots(
  task: TimeLimitedTask,
  now: Date,
  windowMinutes: number,
  timezone: string,
): ReminderSlot[] {
  const policy = task.reminderPolicy
  if (!policy || policy.mode === 'none') return []

  const starts = new Date(task.startsAt).getTime()
  const expires = new Date(task.expiresAt).getTime()
  const nowMs = now.getTime()
  if (nowMs < starts || nowMs >= expires) return []

  const windowMs = windowMinutes * MS_PER_MINUTE
  const slotsMs: number[] = []

  if (policy.mode === 'start_only') {
    if (nowMs - starts < windowMs) slotsMs.push(starts)
  } else if (policy.mode === 'interval' && policy.intervalMinutes) {
    const stepMs = policy.intervalMinutes * MS_PER_MINUTE
    const currentSlotIndex = Math.floor((nowMs - starts) / stepMs)
    const slotMs = starts + currentSlotIndex * stepMs
    if (nowMs - slotMs < windowMs) slotsMs.push(slotMs)
  } else if (
    policy.mode === 'daily' &&
    policy.dailyIntervalDays &&
    policy.dailyHour != null &&
    policy.dailyMinute != null
  ) {
    // Which day this is since the window opened, in the recipient's own
    // timezone - only a multiple of dailyIntervalDays is a reminder day. A
    // chosen time that has already passed on the window's opening day simply
    // never falls inside the tolerance window that day, which is exactly
    // "the first reminder waits for tomorrow" without any extra case for it.
    const startDate = todayIn(timezone, new Date(starts))
    const currentDate = todayIn(timezone, now)
    const daysSinceStart = daysBetween(startDate, currentDate)
    if (daysSinceStart >= 0 && daysSinceStart % policy.dailyIntervalDays === 0) {
      const targetMinutes = policy.dailyHour * 60 + policy.dailyMinute
      const sinceDue = minutesOfDayIn(timezone, now) - targetMinutes
      if (sinceDue >= 0 && sinceDue < windowMinutes) {
        const hh = String(policy.dailyHour).padStart(2, '0')
        const mm = String(policy.dailyMinute).padStart(2, '0')
        // Not a real shared instant - a daily cadence has none - just a
        // stable, unique dedup key for this (task, calendar day, time).
        slotsMs.push(Date.parse(`${currentDate}T${hh}:${mm}:00.000Z`))
      }
    }
  }

  // An add-on, independent of the main mode above - "none" of the regular
  // cadence still gets this one extra nudge if it was asked for.
  if (policy.finalReminderMinutesBeforeExpiry != null) {
    const finalSlotMs = expires - policy.finalReminderMinutesBeforeExpiry * MS_PER_MINUTE
    if (finalSlotMs >= starts && nowMs >= finalSlotMs && nowMs - finalSlotMs < windowMs) {
      slotsMs.push(finalSlotMs)
    }
  }

  // The main cadence and the final-reminder add-on can land on the very same
  // instant (a short window with a large finalReminderMinutesBeforeExpiry) -
  // de-duplicate so that does not try to log the same slot twice in one pass.
  return [...new Set(slotsMs)].map((ms) => ({ taskId: task.id, slot: new Date(ms).toISOString() }))
}
