// The Saturday-evening recap: what got done this week, in each space.
//
// Kept apart from send-reminders/index.ts (Deno-only, database-bound) so the
// counting and the wording can be unit tested, like taskDue.ts and
// messages.ts already are.

import { addDays, dayOfWeek } from './taskDue.ts'
import type { Language } from './messages.ts'

/** Saturday, after Shabbat - the start of the household's new week. */
export const SUMMARY_WEEKDAY = 6
export const SUMMARY_MINUTES = 20 * 60

/** Whether this person's own clock has just passed Saturday 20:00. */
export function isSummaryTime(localDate: string, localMinutes: number, windowMinutes: number): boolean {
  if (dayOfWeek(localDate) !== SUMMARY_WEEKDAY) return false
  const since = localMinutes - SUMMARY_MINUTES
  return since >= 0 && since < windowMinutes
}

/** The first day of the week that ends on `weekEnd` (seven days, inclusive). */
export function weekStart(weekEnd: string): string {
  return addDays(weekEnd, -6)
}

export interface SummaryCompletion {
  space_id: string
  user_id: string
  points_awarded: number
  completed_on: string
  completion_group: string | null
}

export interface SpaceWeek {
  spaceId: string
  /** Things that got done, a "together" completion counted once. */
  total: number
  /** Of those, how many this person was credited for. */
  mine: number
  myPoints: number
  /** Whoever earned the most points this week; null in a quiet week. */
  topUserId: string | null
}

/** One space's week, from one person's point of view. */
export function summarizeSpaceWeek(
  completions: SummaryCompletion[],
  spaceId: string,
  userId: string,
  weekEnd: string,
): SpaceWeek {
  const from = weekStart(weekEnd)
  const rows = completions.filter(
    (row) => row.space_id === spaceId && row.completed_on >= from && row.completed_on <= weekEnd,
  )

  const groups = new Set<string>()
  let total = 0
  let mine = 0
  let myPoints = 0
  const pointsByUser = new Map<string, number>()
  for (const row of rows) {
    if (!row.completion_group || !groups.has(row.completion_group)) {
      total++
      if (row.completion_group) groups.add(row.completion_group)
    }
    if (row.user_id === userId) {
      mine++
      myPoints += row.points_awarded
    }
    pointsByUser.set(row.user_id, (pointsByUser.get(row.user_id) ?? 0) + row.points_awarded)
  }

  let topUserId: string | null = null
  let topPoints = 0
  for (const [id, points] of pointsByUser) {
    if (points > topPoints) {
      topUserId = id
      topPoints = points
    }
  }
  return { spaceId, total, mine, myPoints, topUserId }
}

export interface SummaryLine {
  /** Only when the person is in more than one space. */
  spaceName?: string
  total: number
  mine: number
  myPoints: number
  /** null in a quiet week. */
  topName: string | null
  topIsYou: boolean
}

function tasksWord(count: number, language: Language): string {
  if (language === 'en') return count === 1 ? '1 task' : `${count} tasks`
  return count === 1 ? 'משימה אחת' : `${count} משימות`
}

function line(entry: SummaryLine, language: Language): string {
  const prefix = entry.spaceName ? `${entry.spaceName}: ` : ''
  if (language === 'en') {
    if (entry.total === 0) return `${prefix}A quiet week - nothing was done.`
    const mine = entry.mine > 0 ? `, ${entry.mine} by you (+${entry.myPoints} pts)` : ''
    const top = entry.topIsYou ? ' You led the week!' : entry.topName ? ` Top of the week: ${entry.topName}.` : ''
    return `${prefix}${tasksWord(entry.total, 'en')} done${mine}.${top}`
  }
  if (entry.total === 0) return `${prefix}שבוע שקט - לא בוצעו משימות.`
  const mine = entry.mine > 0 ? `, ${entry.mine === 1 ? 'אחת' : entry.mine} מהן על ידך (+${entry.myPoints} נק')` : ''
  const top = entry.topIsYou ? ' המקום הראשון השבוע שלך!' : entry.topName ? ` בראש הטבלה: ${entry.topName}.` : ''
  const done = entry.total === 1 ? 'בוצעה השבוע משימה אחת' : `בוצעו השבוע ${entry.total} משימות`
  return `${prefix}${done}${mine}.${top}`
}

export function composeWeeklySummary(entries: SummaryLine[], language: Language): { title: string; body: string } {
  return {
    title: language === 'en' ? 'Your week in HouseHero' : 'הסיכום השבועי',
    body: entries.map((entry) => line(entry, language)).join('\n'),
  }
}
