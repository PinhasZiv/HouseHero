// How each task's rhythm actually plays out against the one it was given:
// done ahead of time, on time, late, skipped, or missed - and, from that,
// whether its interval looks wrong in either direction.
//
// Pure functions over the same rows the Stats screen and the details sheet
// already load (completions and skips, each carrying the due date it was
// handled against), so the household view and one task's view always agree.

import { addDays, cycleLateness, daysBetween, missedOccurrenceDates, type CyclicTask } from './taskDue'

export interface CadenceCompletion {
  task_id: string
  completed_on: string
  prev_due_date?: string | null
  completion_group: string | null
}

export interface CadenceSkip {
  task_id: string
  skipped_on: string
  prev_due_date?: string | null
}

export interface CadenceTask extends CyclicTask {
  id: string
  title: string
  due_date: string
  is_done: boolean
  last_completed_date: string | null
}

export type Timing = 'early' | 'onTime' | 'late'

/** Ahead of its due date, on it (or on a later occurrence's, once a full
 *  cycle has gone by - the misses before it are counted on their own), or
 *  late - the same wrap the lateness badge uses. */
export function completionTiming(task: CyclicTask | null, prevDue: string, completedOn: string): Timing {
  const raw = daysBetween(prevDue, completedOn)
  if (raw < 0) return 'early'
  const late = task ? cycleLateness(task, prevDue, raw) : raw
  return late === 0 ? 'onTime' : 'late'
}

export interface CadenceCounts {
  early: number
  onTime: number
  late: number
  skipped: number
  missed: number
}

export interface TaskCadence extends CadenceCounts {
  taskId: string
  /** Days between consecutive completions, oldest first. */
  gaps: number[]
}

function emptyCounts(): CadenceCounts {
  return { early: 0, onTime: 0, late: 0, skipped: 0, missed: 0 }
}

/**
 * Every task's counts from `from` (inclusive, or all history when null) to
 * today. A "together" completion counts once. Missed occurrences come from
 * the gaps before each handled one and from the stretch still open now -
 * except for a task frozen for a vacation.
 */
export function summarizeCadence<T extends CadenceTask>(
  tasks: T[],
  completions: CadenceCompletion[],
  skips: CadenceSkip[],
  today: string,
  from: string | null,
  isPaused: (task: T) => boolean = () => false,
): { total: CadenceCounts; byTask: Map<string, TaskCadence> } {
  const tasksById = new Map(tasks.map((task) => [task.id, task]))
  const byTask = new Map<string, TaskCadence>()
  const entry = (taskId: string) => {
    let found = byTask.get(taskId)
    if (!found) {
      found = { taskId, ...emptyCounts(), gaps: [] }
      byTask.set(taskId, found)
    }
    return found
  }
  const inRange = (date: string) => (from === null || date >= from) && date <= today
  const missedDates = new Map<string, Set<string>>()
  const addMissed = (task: T, prevDue: string, handledOn: string) => {
    if (task.task_type !== 'recurring') return
    const seen = missedDates.get(task.id) ?? new Set<string>()
    for (const date of missedOccurrenceDates(task, prevDue, handledOn)) if (inRange(date)) seen.add(date)
    missedDates.set(task.id, seen)
  }

  const seenGroups = new Set<string>()
  const doneDates = new Map<string, string[]>()
  for (const row of completions) {
    if (row.completion_group) {
      if (seenGroups.has(row.completion_group)) continue
      seenGroups.add(row.completion_group)
    }
    const task = tasksById.get(row.task_id)
    if (!task || task.task_type === 'time_limited') continue
    if (row.prev_due_date) addMissed(task, row.prev_due_date, row.completed_on)
    if (!inRange(row.completed_on)) continue
    entry(row.task_id)[completionTiming(task, row.prev_due_date ?? row.completed_on, row.completed_on)] += 1
    doneDates.set(row.task_id, [...(doneDates.get(row.task_id) ?? []), row.completed_on])
  }

  for (const row of skips) {
    const task = tasksById.get(row.task_id)
    if (!task) continue
    if (row.prev_due_date) addMissed(task, row.prev_due_date, row.skipped_on)
    if (inRange(row.skipped_on)) entry(row.task_id).skipped += 1
  }

  for (const task of tasks) {
    if (task.is_done || isPaused(task)) continue
    addMissed(task, task.due_date, today)
  }

  for (const [taskId, dates] of missedDates) if (dates.size) entry(taskId).missed += dates.size

  for (const [taskId, dates] of doneDates) {
    const sorted = [...dates].sort()
    entry(taskId).gaps = sorted.slice(1).map((date, i) => daysBetween(sorted[i], date))
  }

  const total = emptyCounts()
  for (const counts of byTask.values()) {
    total.early += counts.early
    total.onTime += counts.onTime
    total.late += counts.late
    total.skipped += counts.skipped
    total.missed += counts.missed
  }
  return { total, byTask }
}

export function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** How far back a suggestion looks, and how much it needs to see first. */
export const SUGGESTION_WINDOW_DAYS = 60
export const SUGGESTION_MIN_CYCLES = 5

export interface CadenceSuggestion {
  taskId: string
  direction: 'shorter' | 'longer'
  current: number
  suggested: number
  /** Median days between completions, when there are any to measure. */
  actualGap: number | null
  /** For "longer": how many of the cycles were skipped or missed. */
  dropped: number
  cycles: number
}

/**
 * An interval change worth offering, or null. Only for a task repeating
 * every N days (fixed weekdays have no single interval to change), and only
 * once it has gone through enough cycles to call it a pattern:
 * - mostly done early, and actually done clearly more often than set
 *   -> shorten to the real rhythm;
 * - skipped or missed in a large share of cycles -> lengthen.
 * The median, not the mean, so one odd week does not decide.
 */
export function suggestInterval(task: CadenceTask, cadence: TaskCadence | undefined): CadenceSuggestion | null {
  if (!cadence || task.task_type !== 'recurring' || task.recurrence_mode !== 'interval' || task.is_done) return null
  const current = task.interval_days ?? 1
  const done = cadence.early + cadence.onTime + cadence.late
  const cycles = done + cadence.skipped + cadence.missed
  if (cycles < SUGGESTION_MIN_CYCLES) return null
  const actualGap = median(cadence.gaps)
  const base = { taskId: task.id, current, actualGap, cycles, dropped: cadence.skipped + cadence.missed }

  if (done >= 4 && cadence.early / done >= 0.5 && actualGap !== null) {
    const margin = Math.max(1, Math.round(current * 0.25))
    const suggested = Math.max(1, Math.round(actualGap))
    if (actualGap <= current - margin && suggested < current) return { ...base, direction: 'shorter', suggested }
  }

  if (base.dropped / cycles >= 0.4) {
    // Toward the real rhythm when there is one, but at most double - a task
    // done twice in two months should not jump straight to every 30 days.
    const fromGap =
      actualGap !== null && actualGap > current ? Math.min(Math.round(actualGap), current * 2) : Math.ceil(current * 1.5)
    const suggested = Math.min(365, Math.max(current + 1, fromGap))
    return { ...base, direction: 'longer', suggested }
  }

  return null
}

/**
 * What changing the interval does to the next due date: it follows from the
 * last completion at the new pace - but never lands before today (a shorter
 * interval should not make a task late on the spot), never moves a task
 * already late out of being late, and a longer one never pulls it closer.
 */
export function planIntervalChange(
  task: Pick<CadenceTask, 'due_date' | 'last_completed_date'>,
  newInterval: number,
  current: number,
  today: string,
): { interval_days: number; due_date: string } {
  if (!task.last_completed_date) return { interval_days: newInterval, due_date: task.due_date }
  const candidate = addDays(task.last_completed_date, newInterval)
  if (newInterval < current) {
    const notBeforeToday = candidate < today ? today : candidate
    return { interval_days: newInterval, due_date: notBeforeToday < task.due_date ? notBeforeToday : task.due_date }
  }
  return { interval_days: newInterval, due_date: candidate > task.due_date ? candidate : task.due_date }
}
