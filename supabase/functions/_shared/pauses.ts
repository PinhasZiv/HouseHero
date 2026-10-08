// Vacation mode: which tasks and people are frozen right now.
//
// Shared by the app (to show a task as paused instead of late) and by the
// reminder Edge Function (to stay quiet), so the two cannot disagree about
// who is away. See 0013_pauses.sql for the rules themselves.

export interface Pause {
  id: string
  space_id: string
  /** null means the whole space is paused. */
  user_id: string | null
  started_on: string
  /** null while the pause is on. */
  ended_on: string | null
}

export interface PausableTask {
  space_id: string
  assigned_to: string | null
}

function active(pauses: Pause[]): Pause[] {
  return pauses.filter((pause) => pause.ended_on === null)
}

/** The whole-space pause switched on for this space, if any. */
export function spacePause(pauses: Pause[], spaceId: string): Pause | null {
  return active(pauses).find((pause) => pause.space_id === spaceId && pause.user_id === null) ?? null
}

/** This person's own pause switched on in this space, if any. */
export function personalPause(pauses: Pause[], spaceId: string, userId: string): Pause | null {
  return active(pauses).find((pause) => pause.space_id === spaceId && pause.user_id === userId) ?? null
}

/** Whether this person hears nothing from this space right now - they are
 *  away themselves, or everyone is. */
export function isUserPaused(pauses: Pause[], spaceId: string, userId: string): boolean {
  return spacePause(pauses, spaceId) !== null || personalPause(pauses, spaceId, userId) !== null
}

/** Whether a task is frozen: everyone in its space is away, or the one
 *  person it is assigned to is. An unassigned task carries on for whoever
 *  is still home. */
export function isTaskPaused(pauses: Pause[], task: PausableTask): boolean {
  if (spacePause(pauses, task.space_id)) return true
  return task.assigned_to !== null && personalPause(pauses, task.space_id, task.assigned_to) !== null
}

/**
 * The day someone's silence should be counted from: their last completion,
 * or the last day they came back from a pause that covered them, whichever
 * is later. Being away is not the same as slacking off.
 */
export function activityFloor(pauses: Pause[], spaceId: string, userId: string): string | null {
  let latest: string | null = null
  for (const pause of pauses) {
    if (pause.space_id !== spaceId || pause.ended_on === null) continue
    if (pause.user_id !== null && pause.user_id !== userId) continue
    if (!latest || pause.ended_on > latest) latest = pause.ended_on
  }
  return latest
}
