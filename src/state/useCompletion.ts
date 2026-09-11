import { planCompletion } from '../lib/taskDue'
import * as api from '../lib/api'
import { useI18n } from '../lib/i18n'
import { useToast } from '../components/Toast'
import { useApp } from './AppState'
import type { Task } from '../lib/types'

/**
 * Completing and un-completing a task, shared between every screen that shows
 * a task card, so "mark it done from Today" and "mark it done early from the
 * Tasks list" cannot drift into two different implementations.
 */
export function useCompletion() {
  const { today, session, profile, setProfile, patchTask, reload } = useApp()
  const { t } = useI18n()
  const toast = useToast()
  const selfId = session?.user.id ?? null

  /**
   * Marks a task done right now. There is no due-date check - a task someone
   * notices needs doing can be completed even if the schedule says it is not
   * due for days yet, which restarts a recurring task's schedule from today.
   */
  async function complete(task: Task) {
    if (!selfId) return
    // Optimistic: the tap should feel instant even on a slow connection. If
    // the write fails, reload() brings back the real state.
    const previousTask = { ...task }
    const previousProfile = profile ? { ...profile } : null
    const outcome = planCompletion(task, today)

    patchTask({
      ...task,
      due_date: outcome.nextDueDate ?? task.due_date,
      last_completed_date: today,
      last_completed_by: selfId,
      occurrences_completed: outcome.occurrencesCompleted,
      is_done: outcome.finished,
    })
    if (profile) {
      setProfile({
        ...profile,
        lifetime_points: profile.lifetime_points + task.points,
        spendable_points: profile.spendable_points + task.points,
      })
    }

    try {
      await api.completeTask(task.id, today)
      toast.show(t.task.completed(task.title, task.points), {
        action: {
          label: t.common.undo,
          // The toast's Undo calls the same undo action the persistent button
          // calls, just without its own confirmation - the toast itself is
          // confirmation enough that the action registered.
          run: () => undo(task, { silent: true }),
        },
      })
    } catch (cause) {
      patchTask(previousTask)
      if (previousProfile) setProfile(previousProfile)
      toast.showError(cause)
      void reload()
    }
  }

  /**
   * Reverses a task's most recent completion. The server is the real guard on
   * who may do this - see undo_last_completion() - so this never has a
   * client-held "previous state" to fall back on: it always patches with
   * whatever the server says the task now looks like.
   */
  async function undo(task: Task, options?: { silent?: boolean }) {
    try {
      const restored = await api.undoTaskCompletion(task.id)
      patchTask(restored)
      void reload() // the points that came off are on the profile, not the task
      if (!options?.silent) toast.show(t.task.completionUndone(task.title))
    } catch (cause) {
      toast.showError(cause)
      void reload()
    }
  }

  return { complete, undo }
}
