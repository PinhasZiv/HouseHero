// One task's full history, cycle by cycle: every occurrence that was done,
// skipped, or went by with nobody doing it, plus the stretches it was frozen
// for a vacation.
//
// Nothing records a miss as it happens - a miss is the absence of an event.
// But every completion and skip snapshots the date the task was due at that
// moment (prev_due_date), so the occurrences that went by in between are
// recoverable exactly, by the same grid walk the lateness badge uses. That
// also means this works on history recorded before it existed.

import { missedOccurrenceDates, type CyclicTask } from './taskDue'
import type { Pause } from './pauses'

export interface TimelineCompletion {
  id: string
  user_id: string
  points_awarded: number
  completed_on: string
  created_at: string
  completion_group: string | null
  /** The task's due date when this completion happened. */
  prev_due_date?: string | null
}

export interface TimelineSkip {
  id: string
  user_id: string
  skipped_on: string
  created_at: string
  prev_due_date?: string | null
}

export interface TimelineTask extends CyclicTask {
  id: string
  space_id: string
  assigned_to: string | null
  due_date: string
  is_done: boolean
}

export type TimelineEntry =
  | {
      kind: 'done'
      key: string
      date: string
      createdAt: string
      userId: string
      points: number
      /** How many people a "together" completion credited; 1 otherwise. */
      people: number
    }
  | { kind: 'skipped'; key: string; date: string; createdAt: string; userId: string }
  | { kind: 'missed'; key: string; date: string }
  | { kind: 'vacation'; key: string; date: string; until: string | null; userId: string | null }

/**
 * Newest first. `completions` may hold several rows per "together"
 * completion (one per person credited); they are collapsed to one entry.
 * `isPausedNow` keeps a task frozen for a vacation right now from counting
 * its current stretch as missed.
 */
export function buildTimeline(
  task: TimelineTask,
  completions: TimelineCompletion[],
  skips: TimelineSkip[],
  pauses: Pause[],
  today: string,
  isPausedNow = false,
): TimelineEntry[] {
  const entries: TimelineEntry[] = []

  const groupSizes = new Map<string, number>()
  for (const row of completions) {
    if (row.completion_group) groupSizes.set(row.completion_group, (groupSizes.get(row.completion_group) ?? 0) + 1)
  }
  const seenGroups = new Set<string>()
  const handled: { prevDue: string | null | undefined; on: string }[] = []

  for (const row of completions) {
    if (row.completion_group) {
      if (seenGroups.has(row.completion_group)) continue
      seenGroups.add(row.completion_group)
    }
    entries.push({
      kind: 'done',
      key: row.id,
      date: row.completed_on,
      createdAt: row.created_at,
      userId: row.user_id,
      points: row.points_awarded,
      people: row.completion_group ? (groupSizes.get(row.completion_group) ?? 1) : 1,
    })
    handled.push({ prevDue: row.prev_due_date, on: row.completed_on })
  }

  for (const row of skips) {
    entries.push({ kind: 'skipped', key: row.id, date: row.skipped_on, createdAt: row.created_at, userId: row.user_id })
    handled.push({ prevDue: row.prev_due_date, on: row.skipped_on })
  }

  if (task.task_type === 'recurring') {
    // Each handled occurrence: whatever went by before it, unhandled.
    for (const event of handled) {
      if (!event.prevDue) continue
      for (const date of missedOccurrenceDates(task, event.prevDue, event.on)) {
        entries.push({ kind: 'missed', key: `missed-${date}`, date })
      }
    }
    // And the stretch still open right now.
    if (!task.is_done && !isPausedNow) {
      for (const date of missedOccurrenceDates(task, task.due_date, today)) {
        entries.push({ kind: 'missed', key: `missed-${date}`, date })
      }
    }
  }

  for (const pause of pauses) {
    if (pause.space_id !== task.space_id) continue
    // The whole space, or whoever the task is assigned to now.
    if (pause.user_id !== null && pause.user_id !== task.assigned_to) continue
    entries.push({ kind: 'vacation', key: `pause-${pause.id}`, date: pause.started_on, until: pause.ended_on, userId: pause.user_id })
  }

  // Two handled events can derive the same missed date only if history was
  // edited around them; one row per date is enough.
  const unique = new Map<string, TimelineEntry>()
  for (const entry of entries) unique.set(entry.key, entry)

  return [...unique.values()].sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date)
    const at = (entry: TimelineEntry) => ('createdAt' in entry ? entry.createdAt : '')
    return at(b).localeCompare(at(a))
  })
}
