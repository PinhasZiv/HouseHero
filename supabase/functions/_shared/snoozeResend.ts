// Deciding which expired snoozes deserve a fresh push - kept separate from
// send-reminders/index.ts (which does the actual database reads/writes, and
// is Deno-only) so this can be unit tested without a database or the Deno
// runtime, the same way taskDue.ts and messages.ts already are.

import { classify, type DueTask } from './taskDue.ts'
import { composeReminder, type Language } from './messages.ts'

export interface ExpiredSnooze {
  taskId: string
  userId: string
}

export interface SnoozeTask extends DueTask {
  id: string
  title: string
  space_id: string
}

export type SnoozeOutcome =
  | {
      kind: 'resend'
      taskId: string
      userId: string
      language: Language
      daysLate: number
      title: string
      body: string
    }
  // The task was completed, deleted, or is no longer notifiable since it was
  // snoozed - nothing to send, the snooze row is just stale.
  | { kind: 'stale'; taskId: string; userId: string }

/**
 * Decides, for each expired snooze, whether it should still produce a push.
 *
 * classify() is the single source of truth for "is this task still due" -
 * same function the periodic reminder uses - so a task that was completed (or
 * whose schedule changed) while snoozed is never nagged about again just
 * because the snooze timer ran out.
 */
export function planSnoozeOutcomes(
  expired: ExpiredSnooze[],
  tasksById: Map<string, SnoozeTask>,
  localDateForUser: (userId: string) => string | null,
  languageForUser: (userId: string) => Language,
): SnoozeOutcome[] {
  return expired.map((snooze) => {
    const task = tasksById.get(snooze.taskId)
    const localDate = task ? localDateForUser(snooze.userId) : null
    const info = task && localDate ? classify(task, localDate) : null

    if (!task || !localDate || !info?.notifiable) {
      return { kind: 'stale', taskId: snooze.taskId, userId: snooze.userId }
    }

    const language = languageForUser(snooze.userId)
    const { title, body } = composeReminder([{ name: task.title, daysLate: info.daysLate }], language)
    return {
      kind: 'resend',
      taskId: snooze.taskId,
      userId: snooze.userId,
      language,
      daysLate: info.daysLate,
      title,
      body,
    }
  })
}
