// Household-wide insights derived from the same completion rows the Stats
// screen already fetches - each one a small, independently testable function
// rather than logic buried inside the screen's own useMemo blocks.

import { cycleLateness, dayOfWeek, daysBetween, missedCycles as cyclesMissedFor } from './taskDue'
import type { StatsCompletion } from './api'
import type { Task } from './types'

/** How late a completion actually reads as, once wrapped to the task's own
 *  repeating schedule - see cycleLateness() for why a chronically-late
 *  recurring task does not just accumulate lateness forever. Zero for an
 *  on-time or early completion. */
function wrappedDaysLate(row: StatsCompletion): number {
  const rawLate = daysBetween(row.prev_due_date, row.completed_on)
  if (rawLate <= 0 || !row.task) return Math.max(0, rawLate)
  return cycleLateness(row.task, row.prev_due_date, rawLate)
}

/**
 * A "together" completion inserts one row per person credited, all sharing
 * completion_group - it happened once, so anything counting physical events
 * (not personal credit) must count that group once, not once per person.
 */
export function dedupeCompletionGroups<T extends { completion_group: string | null }>(rows: T[]): T[] {
  const seen = new Set<string>()
  return rows.filter((row) => {
    if (!row.completion_group) return true
    if (seen.has(row.completion_group)) return false
    seen.add(row.completion_group)
    return true
  })
}

export const WEEKLY_TREND_WEEKS = 6

export interface WeekBucket {
  /** How many trailing 7-day windows back this bucket is - 0 is the most
   *  recent (today back 6 days), matching the existing "last 7 days" stat
   *  rather than a calendar week, which would need a week-start convention
   *  of its own. */
  weeksAgo: number
  count: number
  points: number
}

/** Household-wide completions per trailing week, oldest first, for a
 *  momentum-over-time view - not broken down per person, to keep it
 *  readable at a glance. */
export function weeklyTrend(completions: StatsCompletion[], today: string): WeekBucket[] {
  const buckets: WeekBucket[] = []
  for (let weeksAgo = WEEKLY_TREND_WEEKS - 1; weeksAgo >= 0; weeksAgo--) {
    buckets.push({ weeksAgo, count: 0, points: 0 })
  }
  const byWeeksAgo = new Map(buckets.map((bucket) => [bucket.weeksAgo, bucket]))

  for (const row of dedupeCompletionGroups(completions)) {
    const daysAgo = daysBetween(row.completed_on, today)
    if (daysAgo < 0) continue // a completion cannot be in the future
    const bucket = byWeeksAgo.get(Math.floor(daysAgo / 7))
    if (!bucket) continue // older than the window this tracks
    bucket.count += 1
    bucket.points += row.points_awarded
  }
  return buckets
}

export interface OnTimeRate {
  onTime: number
  late: number
  total: number
  /** 0-100, rounded; null when there is nothing eligible to measure yet. */
  percent: number | null
}

/**
 * How often a task got done by its own deadline - ordinary tasks only. A
 * time-limited task's due_date is not a real deadline the same way (it can
 * be completed any time inside its own window), so it is excluded rather
 * than silently counted as always on time or always late.
 */
export function onTimeRate(completions: StatsCompletion[]): OnTimeRate {
  const eligible = dedupeCompletionGroups(completions).filter((row) => row.task?.task_type !== 'time_limited')
  let onTime = 0
  let late = 0
  for (const row of eligible) {
    if (wrappedDaysLate(row) > 0) late += 1
    else onTime += 1
  }
  const total = onTime + late
  return { onTime, late, total, percent: total > 0 ? Math.round((onTime / total) * 100) : null }
}

export interface NeglectedTask {
  taskId: string
  title: string
  avgDaysLate: number
  count: number
}

/** Ignore anything completed fewer times than this - one unlucky day on a
 *  task nobody has repeated yet should not read as a pattern. */
const MIN_COMPLETIONS_FOR_NEGLECTED = 2

/** The ordinary task with the worst average lateness across its own
 *  completions - the down side of "most popular task" already shown. */
export function mostNeglectedTask(completions: StatsCompletion[]): NeglectedTask | null {
  const byTask = new Map<string, { title: string; totalDaysLate: number; count: number }>()

  for (const row of dedupeCompletionGroups(completions)) {
    if (row.task?.task_type === 'time_limited') continue
    const daysLate = wrappedDaysLate(row)
    const entry = byTask.get(row.task_id) ?? { title: row.task?.title ?? '?', totalDaysLate: 0, count: 0 }
    entry.totalDaysLate += daysLate
    entry.count += 1
    byTask.set(row.task_id, entry)
  }

  const worst = [...byTask.entries()]
    .filter(([, entry]) => entry.count >= MIN_COMPLETIONS_FOR_NEGLECTED)
    .map(([taskId, entry]) => ({
      taskId,
      title: entry.title,
      avgDaysLate: entry.totalDaysLate / entry.count,
      count: entry.count,
    }))
    .sort((a, b) => b.avgDaysLate - a.avgDaysLate)[0]

  return worst && worst.avgDaysLate > 0 ? worst : null
}

export interface BusiestWeekday {
  /** 0 (Sunday) through 6 (Saturday) - matches dayOfWeek()/weekdayShort(). */
  weekday: number
  count: number
}

/** Which day of the week carries the most completions, across all history. */
export function busiestWeekday(completions: StatsCompletion[]): BusiestWeekday | null {
  const counts = new Array(7).fill(0)
  for (const row of dedupeCompletionGroups(completions)) {
    counts[dayOfWeek(row.completed_on)] += 1
  }
  const max = Math.max(...counts)
  return max > 0 ? { weekday: counts.indexOf(max), count: max } : null
}

export interface MissedCyclesEntry {
  taskId: string
  title: string
  missed: number
}

export interface MissedCyclesSummary {
  total: number
  /** Worst offender first; empty when nothing has ever skipped a cycle. */
  byTask: MissedCyclesEntry[]
}

/** How many of a recurring task's own cycles were skipped entirely before an
 *  eventual completion - the "already done" half of the missed-cycles
 *  picture, from history. */
export function missedCyclesFromHistory(completions: StatsCompletion[]): MissedCyclesEntry[] {
  const byTask = new Map<string, MissedCyclesEntry>()
  for (const row of dedupeCompletionGroups(completions)) {
    if (!row.task || row.task.task_type !== 'recurring') continue
    const rawLate = daysBetween(row.prev_due_date, row.completed_on)
    const missed = cyclesMissedFor(row.task, row.prev_due_date, rawLate)
    if (missed <= 0) continue
    const entry = byTask.get(row.task_id) ?? { taskId: row.task_id, title: row.task.title, missed: 0 }
    entry.missed += missed
    byTask.set(row.task_id, entry)
  }
  return [...byTask.values()]
}

/** Currently-open recurring tasks that have already skipped one or more full
 *  cycles right now, even though nobody has completed them yet - the "still
 *  slipping" half a completion history alone cannot show, since these have
 *  no completion row at all. */
export function missedCyclesFromOpenTasks(tasks: Task[], today: string): MissedCyclesEntry[] {
  const entries: MissedCyclesEntry[] = []
  for (const task of tasks) {
    if (task.is_done || task.task_type !== 'recurring') continue
    const rawLate = daysBetween(task.due_date, today)
    const missed = cyclesMissedFor(task, task.due_date, rawLate)
    if (missed > 0) entries.push({ taskId: task.id, title: task.title, missed })
  }
  return entries
}

/**
 * How often recurring tasks are being skipped outright - combining a task
 * that eventually got done late (from history) with one that is still open
 * and already past a cycle boundary right now. Together they answer "are we
 * skipping recurring tasks a lot", broken down by task so a repeat offender
 * stands out rather than being buried in one household-wide number.
 */
export function missedCyclesSummary(
  completions: StatsCompletion[],
  tasks: Task[],
  today: string,
): MissedCyclesSummary {
  const byTask = new Map<string, MissedCyclesEntry>()
  for (const entry of [...missedCyclesFromHistory(completions), ...missedCyclesFromOpenTasks(tasks, today)]) {
    const existing = byTask.get(entry.taskId) ?? { taskId: entry.taskId, title: entry.title, missed: 0 }
    existing.missed += entry.missed
    byTask.set(entry.taskId, existing)
  }
  const byTaskList = [...byTask.values()].sort((a, b) => b.missed - a.missed)
  return { total: byTaskList.reduce((sum, entry) => sum + entry.missed, 0), byTask: byTaskList }
}

export interface InactiveMember {
  userId: string
  /** null means never completed anything at all, in this space's history. */
  daysSinceLastCompletion: number | null
}

/** How many days of silence before someone shows up here. */
export const INACTIVE_THRESHOLD_DAYS = 3

/**
 * Space members who have not completed anything recently, worst first -
 * including someone who never has at all, which the leaderboard itself
 * cannot show since it only ever lists people who already have a completion.
 */
export function inactiveMembers(memberIds: string[], completions: StatsCompletion[], today: string): InactiveMember[] {
  const lastByUser = new Map<string, string>()
  for (const row of completions) {
    const current = lastByUser.get(row.user_id)
    if (!current || row.completed_on > current) lastByUser.set(row.user_id, row.completed_on)
  }

  return memberIds
    .map((userId) => {
      const last = lastByUser.get(userId)
      return { userId, daysSinceLastCompletion: last ? daysBetween(last, today) : null }
    })
    .filter((entry) => entry.daysSinceLastCompletion === null || entry.daysSinceLastCompletion >= INACTIVE_THRESHOLD_DAYS)
    .sort((a, b) => {
      if (a.daysSinceLastCompletion === null) return -1
      if (b.daysSinceLastCompletion === null) return 1
      return b.daysSinceLastCompletion - a.daysSinceLastCompletion
    })
}
