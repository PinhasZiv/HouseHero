import { firstName } from '../lib/format'
import { planCompletion, todayIn } from '../lib/taskDue'
import * as api from '../lib/api'
import type { CompletionChoice } from '../lib/api'
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
  const { today, session, profile, people, setProfile, patchTask, reload } = useApp()
  const { t, language } = useI18n()
  const toast = useToast()
  const selfId = session?.user.id ?? null

  /**
   * Marks a task done right now. There is no due-date check - a task someone
   * notices needs doing can be completed even if the schedule says it is not
   * due for days yet, which restarts a recurring task's schedule from today.
   *
   * `choice` defaults to crediting whoever calls this. It can instead credit
   * someone else, or several people at once - see CompletionChoice and
   * complete_task() for what each does server-side.
   */
  async function complete(task: Task, choice: CompletionChoice = {}): Promise<boolean> {
    if (!selfId) return false
    // A backdated completion was chosen against this device's own clock, so
    // the calendar-day it lands on is read in this device's own timezone too
    // - the same precedent formatSnoozeUntil already follows for the same
    // reason. Left out entirely, this is just today, same as always.
    const completedOn = choice.completedAt
      ? todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone, new Date(choice.completedAt))
      : today

    // Optimistic: the tap should feel instant even on a slow connection. If
    // the write fails, reload() brings back the real state.
    const previousTask = { ...task }
    const previousProfile = profile ? { ...profile } : null
    const outcome = planCompletion(task, completedOn)
    const credited = choice.userIds && choice.userIds.length > 0 ? choice.userIds : [selfId]
    const creditsSelf = credited.includes(selfId)

    patchTask({
      ...task,
      due_date: outcome.nextDueDate ?? task.due_date,
      last_completed_date: completedOn,
      last_completed_by: credited,
      last_completed_actor: selfId,
      occurrences_completed: outcome.occurrencesCompleted,
      is_done: outcome.finished,
    })
    if (creditsSelf && profile) {
      setProfile({
        ...profile,
        lifetime_points: profile.lifetime_points + task.points,
        spendable_points: profile.spendable_points + task.points,
      })
    }

    try {
      await api.completeTask(task.id, completedOn, choice)
      if (credited.length > 1) {
        toast.show(t.task.completedByGroupToast(task.title, task.points, credited.length))
      } else if (credited[0] !== selfId) {
        const person = people.get(credited[0])
        const who = person ? firstName(person.display_name, person.email, language) : t.task.someoneElse
        toast.show(t.task.completedForToast(task.title, who, task.points))
      } else {
        toast.show(t.task.completed(task.title, task.points), {
          action: {
            label: t.common.undo,
            // The toast's Undo calls the same undo action the persistent button
            // calls, just without its own confirmation - the toast itself is
            // confirmation enough that the action registered.
            run: () => undo(task, { silent: true }),
          },
        })
      }
      // Crediting anyone besides whoever tapped Done changes points and
      // completed-today state for people this hook has no optimistic patch
      // for - a plain reload picks up their fresh balances instead.
      if (credited.length > 1 || !creditsSelf) void reload()
      return true
    } catch (cause) {
      patchTask(previousTask)
      if (creditsSelf && previousProfile) setProfile(previousProfile)
      toast.showError(cause)
      void reload()
      return false
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
