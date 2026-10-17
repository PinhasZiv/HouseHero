// The weekly report: one household's week, Sunday through Saturday, from the
// rows already stored - completions and skips (each with the due date it
// settled), the tasks themselves, reward redemptions and vacations - plus a
// look at the week after it, projected from where each task stands now.
//
// Shared by the app's report screen and the Saturday-evening push, so the
// figures in the notification are the ones the screen opens on.

import { addDays, classify, planCompletion, todayIn, type DueTask } from './taskDue.ts'
import {
  SUGGESTION_WINDOW_DAYS,
  completionTiming,
  onTimeShare,
  suggestInterval,
  summarizeCadence,
  type CadenceCounts,
  type CadenceSuggestion,
  type CadenceTask,
} from './cadence.ts'
import { brokenDays, houseStreak, type HandledRow } from './streak.ts'
import { weekStart } from './weeklySummary.ts'

export type ReportTask = DueTask & CadenceTask & { assigned_to?: string | null }

export interface ReportCompletion {
  task_id: string
  user_id: string
  points_awarded: number
  completed_on: string
  completion_group: string | null
  prev_due_date?: string | null
}

export interface ReportSkip {
  task_id: string
  skipped_on: string
  prev_due_date: string | null
}

export interface ReportRedemption {
  reward_title: string
  cost: number
  requested_by: string
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  decided_at: string | null
}

/** A vacation in this space: one person's (user_id), or everyone's (null).
 *  The day it ended on is a day back at home. */
export interface ReportPause {
  user_id: string | null
  started_on: string
  ended_on: string | null
}

/** The Saturday that closes the most recent week to have reached its
 *  Saturday - today, when today is one. */
export function latestWeekEnd(today: string): string {
  const [y, m, d] = today.split('-').map(Number)
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return addDays(today, -((weekday + 1) % 7))
}

/** How many rows one history fetch returns at most, in the app and the push. */
export const HISTORY_LIMIT = 1000

/**
 * The first day the report can see: the oldest task's - or, when a page of
 * history came back full, the oldest day on it, since anything before that
 * was cut off and would otherwise read as days nothing went wrong.
 */
export function reportSince(
  firstTaskDay: string,
  completions: { completed_on: string }[],
  skips: { skipped_on: string }[],
): string {
  const oldest = (days: string[]) => days.reduce((min, day) => (day < min ? day : min))
  let since = firstTaskDay
  if (completions.length >= HISTORY_LIMIT) since = maxDay(since, oldest(completions.map((row) => row.completed_on)))
  if (skips.length >= HISTORY_LIMIT) since = maxDay(since, oldest(skips.map((row) => row.skipped_on)))
  return since
}

function maxDay(a: string, b: string): string {
  return a > b ? a : b
}

/**
 * How a day of the week went: every task that fell due was taken care of
 * that day ('closed'), something was left for later ('broken'), it is today
 * and something is still waiting ('open'), it has not come yet ('future'),
 * the household did not exist yet ('none'), or everyone was on vacation
 * ('away'). Only the first three count towards the week's closed days.
 */
export type DayStatus = 'closed' | 'broken' | 'open' | 'future' | 'none' | 'away'

export interface ReportDay {
  date: string
  /** Things done that day, a "together" completion counted once. */
  done: number
  status: DayStatus
}

export interface ReportPerson {
  userId: string
  done: number
  points: number
  /** Of their completions, how many were done together with others. */
  together: number
  /** Share of the week's points, 0-100. */
  share: number
  /** Their own completions on time or early, 0-100 - null with none to time. */
  onTime: number | null
}

export interface WeekFigures {
  done: number
  points: number
  /** Out of everything that fell due, missed cycles included (onTimeShare). */
  onTime: number | null
}

/** The week after the report's, as it stands: what falls due on each day if
 *  everything is done on its day. Days already gone by have no count. */
export interface Outlook {
  from: string
  to: string
  /** Not started yet - "next week" rather than "the rest of this week". */
  upcoming: boolean
  days: { date: string; count: number | null }[]
  items: { taskId: string; title: string; date: string; assignedTo: string | null }[]
}

export interface WeeklyReport {
  weekStart: string
  weekEnd: string
  figures: WeekFigures
  previous: WeekFigures
  days: ReportDay[]
  /** Days so far this week (not future, not before the household began)... */
  daysCounted: number
  /** ...and how many of them were closed. */
  daysClosed: number
  people: ReportPerson[]
  timing: CadenceCounts
  topTask: { taskId: string; title: string; done: number } | null
  missed: { taskId: string; title: string; cycles: number }[]
  /** Late right now - only for the week that has just ended or is running. */
  overdueNow: { taskId: string; title: string; daysLate: number }[]
  /** The household's streak as the week ended, and the last day in it that broke. */
  streak: number
  brokeOn: string | null
  redeemed: { title: string; cost: number; by: string }[]
  pending: { title: string; cost: number; by: string }[]
  /** Vacations during the week, cut to it - the whole space's (userId null)
   *  marks its days 'away'. */
  away: { userId: string | null; from: string; to: string }[]
  /** Only while the week after this one is not over yet. */
  outlook: Outlook | null
  /** Interval changes worth offering, strongest first - as on the Stats
   *  screen, over the last sixty days, so only for a recent week. */
  suggestions: CadenceSuggestion[]
}

function dedupe<T extends { completion_group: string | null }>(rows: T[]): T[] {
  const seen = new Set<string>()
  return rows.filter((row) => {
    if (!row.completion_group) return true
    if (seen.has(row.completion_group)) return false
    seen.add(row.completion_group)
    return true
  })
}

function figures<T extends ReportTask>(
  tasks: T[],
  completions: ReportCompletion[],
  skips: ReportSkip[],
  weekEnd: string,
  today: string,
  isPaused: (task: T) => boolean,
): WeekFigures & { timing: CadenceCounts; byTask: ReturnType<typeof summarizeCadence>['byTask'] } {
  const from = weekStart(weekEnd)
  const rows = completions.filter((row) => row.completed_on >= from && row.completed_on <= weekEnd)
  const upto = weekEnd < today ? weekEnd : today
  const { total, byTask } = summarizeCadence(tasks, completions, skips, upto, from, isPaused)
  return {
    done: dedupe(rows).length,
    points: rows.reduce((sum, row) => sum + row.points_awarded, 0),
    onTime: onTimeShare(total),
    timing: total,
    byTask,
  }
}

/**
 * Every occurrence from `from` to `to`, walking each task forward as if it
 * were done on its due day - something already late counts as done today.
 * Days before today are left out: what happened on them is history.
 */
function projectOccurrences<T extends ReportTask>(
  tasks: T[],
  from: string,
  to: string,
  today: string,
  isPaused: (task: T) => boolean,
): Outlook['items'] {
  const start = from > today ? from : today
  const items: Outlook['items'] = []
  for (const task of tasks) {
    if (task.is_done || task.task_type === 'time_limited' || isPaused(task)) continue
    let occurrences = task.occurrences_completed
    let due: string | null = task.due_date < today ? today : task.due_date
    while (due !== null && due <= to) {
      if (due >= start) items.push({ taskId: task.id, title: task.title, date: due, assignedTo: task.assigned_to ?? null })
      const next = planCompletion({ ...task, occurrences_completed: occurrences }, due)
      occurrences = next.occurrencesCompleted
      due = next.nextDueDate !== null && next.nextDueDate > due ? next.nextDueDate : null
    }
  }
  return items.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title))
}

function suggestionStrength(suggestion: CadenceSuggestion): number {
  return Math.abs(suggestion.suggested - suggestion.current) / suggestion.current
}

export function buildWeeklyReport<T extends ReportTask>(input: {
  tasks: T[]
  completions: ReportCompletion[]
  skips: ReportSkip[]
  redemptions: ReportRedemption[]
  weekEnd: string
  today: string
  /** The first day there is anything to count - the oldest task. */
  since: string
  timezone: string
  isPaused?: (task: T) => boolean
  pauses?: ReportPause[]
}): WeeklyReport {
  const { tasks, completions, skips, redemptions, weekEnd, today, since, timezone } = input
  const isPaused = input.isPaused ?? (() => false)
  const from = weekStart(weekEnd)
  const current = figures(tasks, completions, skips, weekEnd, today, isPaused)
  const prev = figures(tasks, completions, skips, addDays(weekEnd, -7), today, isPaused)
  const tasksById = new Map(tasks.map((task) => [task.id, task]))

  const handled: HandledRow[] = [
    ...completions.map((row) => ({ task_id: row.task_id, on: row.completed_on, prev_due_date: row.prev_due_date ?? null })),
    ...skips.map((row) => ({ task_id: row.task_id, on: row.skipped_on, prev_due_date: row.prev_due_date })),
  ]
  const broken = brokenDays(tasks, handled, today, isPaused)
  const waitingToday = tasks.some(
    (task) =>
      !task.is_done &&
      task.task_type !== 'time_limited' &&
      !isPaused(task) &&
      task.due_date <= today &&
      task.last_completed_date !== today &&
      task.last_skipped_date !== today,
  )

  // Vacations, cut to the part of the week that has happened.
  const lastDay = weekEnd < today ? weekEnd : today
  const away: WeeklyReport['away'] = []
  for (const pause of input.pauses ?? []) {
    const end = pause.ended_on ? addDays(pause.ended_on, -1) : today
    const clipFrom = pause.started_on > from ? pause.started_on : from
    const clipTo = end < lastDay ? end : lastDay
    if (clipFrom <= clipTo) away.push({ userId: pause.user_id, from: clipFrom, to: clipTo })
  }
  away.sort((a, b) => a.from.localeCompare(b.from))
  const everyoneAway = (date: string) => away.some((entry) => entry.userId === null && entry.from <= date && date <= entry.to)

  const weekRows = completions.filter((row) => row.completed_on >= from && row.completed_on <= weekEnd)
  const deduped = dedupe(weekRows)
  const days: ReportDay[] = []
  for (let i = 0; i < 7; i++) {
    const date = addDays(from, i)
    const done = deduped.filter((row) => row.completed_on === date).length
    const status: DayStatus =
      date > today
        ? 'future'
        : date < since
          ? 'none'
          : everyoneAway(date)
            ? 'away'
            : date === today
            ? waitingToday
              ? 'open'
              : 'closed'
            : broken.has(date)
              ? 'broken'
              : 'closed'
    days.push({ date, done, status })
  }
  const counted = days.filter((day) => day.status === 'closed' || day.status === 'broken' || day.status === 'open')

  const byPerson = new Map<string, { done: number; points: number; together: number; onTime: number; timed: number }>()
  for (const row of weekRows) {
    const entry = byPerson.get(row.user_id) ?? { done: 0, points: 0, together: 0, onTime: 0, timed: 0 }
    entry.done += 1
    entry.points += row.points_awarded
    if (row.completion_group) entry.together += 1
    const task = tasksById.get(row.task_id) ?? null
    if (!task || task.task_type !== 'time_limited') {
      const timing = completionTiming(task, row.prev_due_date ?? row.completed_on, row.completed_on)
      entry.timed += 1
      if (timing !== 'late') entry.onTime += 1
    }
    byPerson.set(row.user_id, entry)
  }
  const people: ReportPerson[] = [...byPerson.entries()]
    .map(([userId, entry]) => ({
      userId,
      done: entry.done,
      points: entry.points,
      together: entry.together,
      share: current.points > 0 ? Math.round((entry.points / current.points) * 100) : 0,
      onTime: entry.timed > 0 ? Math.round((entry.onTime / entry.timed) * 100) : null,
    }))
    .sort((a, b) => b.points - a.points || b.done - a.done)

  const doneByTask = new Map<string, number>()
  for (const row of deduped) doneByTask.set(row.task_id, (doneByTask.get(row.task_id) ?? 0) + 1)
  let topTask: WeeklyReport['topTask'] = null
  for (const [taskId, done] of doneByTask) {
    const task = tasksById.get(taskId)
    if (task && (!topTask || done > topTask.done)) topTask = { taskId, title: task.title, done }
  }

  const missed = [...current.byTask.values()]
    .filter((entry) => entry.missed > 0 && tasksById.has(entry.taskId))
    .map((entry) => ({ taskId: entry.taskId, title: tasksById.get(entry.taskId)!.title, cycles: entry.missed }))
    .sort((a, b) => b.cycles - a.cycles)

  const recent = weekEnd >= addDays(today, -6)
  const overdueNow = recent
    ? tasks
        .filter((task) => !isPaused(task))
        .map((task) => ({ task, info: classify(task, today) }))
        .filter(({ info }) => info.status === 'late')
        .map(({ task, info }) => ({ taskId: task.id, title: task.title, daysLate: info.daysLate }))
        .sort((a, b) => b.daysLate - a.daysLate)
    : []

  const streak =
    weekEnd < today
      ? houseStreak({ tasks, handled, today: addDays(weekEnd, 1), since, todayClosed: false, isPaused })
      : houseStreak({ tasks, handled, today, since, todayClosed: !waitingToday, isPaused })
  const brokeOn = [...days].reverse().find((day) => day.status === 'broken')?.date ?? null

  const nextFrom = addDays(weekEnd, 1)
  const nextTo = addDays(weekEnd, 7)
  let outlook: Outlook | null = null
  if (nextTo >= today) {
    const items = projectOccurrences(tasks, nextFrom, nextTo, today, isPaused)
    const days: Outlook['days'] = []
    for (let i = 0; i < 7; i++) {
      const date = addDays(nextFrom, i)
      days.push({ date, count: date < today ? null : items.filter((item) => item.date === date).length })
    }
    outlook = { from: nextFrom, to: nextTo, upcoming: nextFrom > today, days, items }
  }

  const suggestions: CadenceSuggestion[] = []
  if (recent) {
    const { byTask } = summarizeCadence(tasks, completions, skips, today, addDays(today, -SUGGESTION_WINDOW_DAYS), isPaused)
    for (const task of tasks) {
      const suggestion = suggestInterval(task, byTask.get(task.id))
      if (suggestion) suggestions.push(suggestion)
    }
    suggestions.sort((a, b) => suggestionStrength(b) - suggestionStrength(a))
  }

  const decidedInWeek = (row: ReportRedemption) => {
    if (!row.decided_at) return false
    const day = todayIn(timezone, new Date(row.decided_at))
    return day >= from && day <= weekEnd
  }

  return {
    weekStart: from,
    weekEnd,
    figures: { done: current.done, points: current.points, onTime: current.onTime },
    previous: { done: prev.done, points: prev.points, onTime: prev.onTime },
    days,
    daysCounted: counted.length,
    daysClosed: counted.filter((day) => day.status === 'closed').length,
    people,
    timing: current.timing,
    topTask,
    missed,
    overdueNow,
    streak,
    brokeOn,
    redeemed: redemptions
      .filter((row) => row.status === 'approved' && decidedInWeek(row))
      .map((row) => ({ title: row.reward_title, cost: row.cost, by: row.requested_by })),
    pending: redemptions
      .filter((row) => row.status === 'pending')
      .map((row) => ({ title: row.reward_title, cost: row.cost, by: row.requested_by })),
    away,
    outlook,
    suggestions,
  }
}
