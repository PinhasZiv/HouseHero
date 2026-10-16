import { useEffect, useRef, useState } from 'react'
import * as api from '../lib/api'
import { houseStreak, type HandledRow } from '../lib/streak'
import { todayIn } from '../lib/taskDue'
import { useApp } from './AppState'

/** What fetchStatsCompletions()/fetchStatsSkips() return at most - a full
 *  page means older history was cut off, and the streak cannot see past it. */
const HISTORY_LIMIT = 1000

/**
 * The household's streak up to yesterday (see lib/streak.ts), across every
 * space on the Today screen - or null until it has loaded, or if it could
 * not. Today is the caller's to add once today's list is cleared.
 *
 * Recomputed only when fresh history arrives, not on every change to the
 * tasks: a late task done just now stops counting as open before the row
 * recording it has loaded, and computing in between would briefly show a
 * streak that day had already broken.
 */
export function useHouseStreak(): number | null {
  const { tasks, spaces, today, isPaused, profile } = useApp()
  const timezone = profile?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const [streak, setStreak] = useState<number | null>(null)

  const latest = useRef({ tasks, isPaused, today, timezone })
  latest.current = { tasks, isPaused, today, timezone }

  const spaceKey = spaces
    .map((space) => space.id)
    .sort()
    .join(',')
  // Anything that adds or settles history: a completion, a skip, a task
  // moving on to its next due date.
  const historyKey = tasks
    .map((task) => `${task.id}:${task.due_date}:${task.last_completed_date}:${task.last_skipped_date}:${task.is_done}`)
    .sort()
    .join('|')

  useEffect(() => {
    if (!spaceKey) return
    let cancelled = false
    Promise.all(spaceKey.split(',').map((id) => Promise.all([api.fetchStatsCompletions(id), api.fetchStatsSkips(id)])))
      .then((perSpace) => {
        if (cancelled) return
        const { tasks, isPaused, today, timezone } = latest.current
        const handled: HandledRow[] = []
        let floor = ''
        for (const [completions, skips] of perSpace) {
          for (const row of completions) handled.push({ task_id: row.task_id, on: row.completed_on, prev_due_date: row.prev_due_date })
          for (const row of skips) handled.push({ task_id: row.task_id, on: row.skipped_on, prev_due_date: row.prev_due_date })
          // Newest first - a full page's last row is as far back as it reaches.
          if (completions.length >= HISTORY_LIMIT) floor = maxDate(floor, completions[completions.length - 1].completed_on)
          if (skips.length >= HISTORY_LIMIT) floor = maxDate(floor, skips[skips.length - 1].skipped_on)
        }
        const firstTask = tasks.map((task) => todayIn(timezone, new Date(task.created_at))).sort()[0]
        if (!firstTask) {
          setStreak(0)
          return
        }
        setStreak(houseStreak({ tasks, handled, today, since: maxDate(floor, firstTask), todayClosed: false, isPaused }))
      })
      .catch(() => {
        if (!cancelled) setStreak(null)
      })
    return () => {
      cancelled = true
    }
  }, [spaceKey, historyKey, today])

  return streak
}

function maxDate(a: string, b: string): string {
  return a > b ? a : b
}
