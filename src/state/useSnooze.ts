import * as api from '../lib/api'
import { formatSnoozeUntil } from '../lib/format'
import { useI18n } from '../lib/i18n'
import { useToast } from '../components/Toast'
import { useApp } from './AppState'
import type { Task } from '../lib/types'

/**
 * Snoozing and cancelling a snooze, shared between the Today-screen action on
 * a single task and the notification-triggered picker on everything currently
 * due, so both paths patch state and roll back failures the same way.
 */
export function useSnooze() {
  const { session, today, snoozes, patchSnooze, reload } = useApp()
  const { t, language } = useI18n()
  const toast = useToast()
  const selfId = session?.user.id ?? null

  /** Snoozes every task given until the same instant. */
  async function snooze(tasks: Task[], until: string) {
    if (!selfId || tasks.length === 0) return
    // Optimistic, exactly like complete(): the response should feel
    // immediate, and reload() at the end fixes any drift if something failed
    // partway through.
    const previous = tasks.map((task) => ({ id: task.id, until: snoozes.get(task.id) ?? null }))
    tasks.forEach((task) => patchSnooze(task.id, until))

    try {
      await Promise.all(tasks.map((task) => api.snoozeTask(task.id, selfId, until)))
      toast.show(t.snooze.confirmed(formatSnoozeUntil(until, today, language)))
    } catch (cause) {
      previous.forEach(({ id, until: was }) => patchSnooze(id, was))
      toast.showError(cause)
      void reload()
    }
  }

  async function cancelSnooze(task: Task) {
    if (!selfId) return
    const previous = snoozes.get(task.id) ?? null
    patchSnooze(task.id, null)

    try {
      await api.cancelSnooze(task.id, selfId)
      toast.show(t.snooze.cancelled)
    } catch (cause) {
      patchSnooze(task.id, previous)
      toast.showError(cause)
      void reload()
    }
  }

  return { snooze, cancelSnooze }
}
