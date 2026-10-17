// The household's streak: how many days in a row every task that fell due was
// taken care of on its day - done or skipped. One task left for later breaks
// that day for everyone; that is what makes it the household's streak rather
// than anyone's personal score.
//
// Built from the rows the app already has (completions and skips carry the
// due date they settled), with the same cycle rules as the lateness badge and
// the Stats screen's missed cycles - so a day the streak counts as broken is
// a day those screens show something slipped.

import { addDays, cycleLateness, daysBetween, missedOccurrenceDates, type CyclicTask } from './taskDue.ts'

export interface StreakTask extends CyclicTask {
  id: string
  due_date: string
  is_done: boolean
}

/** A completion or a skip: the day it happened, and the due date it settled. */
export interface HandledRow {
  task_id: string
  on: string
  prev_due_date: string | null
}

/**
 * Every day on which an occurrence fell due and was not handled that same
 * day: the occurrences a late completion or skip went past, and those an
 * open task has gone past by today. A time-limited task has a window, not a
 * day, and a task frozen for a vacation is not expected to be done - neither
 * breaks anything.
 */
export function brokenDays<T extends StreakTask>(
  tasks: T[],
  handled: HandledRow[],
  today: string,
  isPaused: (task: T) => boolean = () => false,
): Set<string> {
  const broken = new Set<string>()
  const byId = new Map(tasks.map((task) => [task.id, task]))

  const lapse = (task: T, dueDate: string, handledOn: string) => {
    const raw = daysBetween(dueDate, handledOn)
    if (raw <= 0) return
    if (task.task_type !== 'recurring') {
      broken.add(dueDate)
      return
    }
    for (const date of missedOccurrenceDates(task, dueDate, handledOn)) broken.add(date)
    // The occurrence it was finally handled on (or is on now) - late too,
    // unless the handling landed exactly on it.
    const late = cycleLateness(task, dueDate, raw)
    if (late > 0) broken.add(addDays(handledOn, -late))
  }

  for (const row of handled) {
    const task = byId.get(row.task_id)
    if (!task || task.task_type === 'time_limited' || !row.prev_due_date) continue
    lapse(task, row.prev_due_date, row.on)
  }
  for (const task of tasks) {
    if (task.is_done || task.task_type === 'time_limited' || isPaused(task)) continue
    lapse(task, task.due_date, today)
  }
  return broken
}

/**
 * Days in a row, counting back from yesterday, with nothing left undone -
 * plus today once today's list is cleared. Today itself never breaks it:
 * there is still time. `since` is the first day there is anything to count
 * (the oldest task, or the oldest row the history reaches back to).
 */
export function houseStreak<T extends StreakTask>(options: {
  tasks: T[]
  handled: HandledRow[]
  today: string
  since: string
  todayClosed: boolean
  isPaused?: (task: T) => boolean
  maxDays?: number
}): number {
  const { tasks, handled, today, since, todayClosed, isPaused, maxDays = 365 } = options
  const broken = brokenDays(tasks, handled, today, isPaused)
  let count = 0
  for (let day = addDays(today, -1); day >= since && !broken.has(day) && count < maxDays; day = addDays(day, -1)) {
    count += 1
  }
  return count + (todayClosed ? 1 : 0)
}
