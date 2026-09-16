// Re-exported so app code can import the scheduling rules without reaching
// into the Supabase functions folder. The implementation lives next to the
// Edge Function that also depends on it, which keeps the two in lockstep.
export * from '../../supabase/functions/_shared/taskDue.ts'

import type { Task } from './types'

/** Open tasks sort by when they next ask for attention: due date first, then
 *  the time of day the reminder fires that day. */
export function compareBySchedule(a: Task, b: Task): number {
  const byDate = a.due_date.localeCompare(b.due_date)
  if (byDate !== 0) return byDate
  return a.reminder_hour * 60 + a.reminder_minute - (b.reminder_hour * 60 + b.reminder_minute)
}

/** Completed tasks sort most-recently-finished first. Falls back to the due
 *  date for a completion logged before last_completed_at existed. */
export function compareByCompletion(a: Task, b: Task): number {
  const aTime = a.last_completed_at ?? a.due_date
  const bTime = b.last_completed_at ?? b.due_date
  return bTime.localeCompare(aTime)
}
