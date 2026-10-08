import { planSkip } from '../lib/taskDue'
import * as api from '../lib/api'
import { useI18n } from '../lib/i18n'
import { useToast } from '../components/Toast'
import { useApp } from './AppState'
import type { Task } from '../lib/types'

/**
 * Skipping one occurrence of a recurring task - "not needed this time", the
 * dishwasher that does not actually need running today. Mirrors
 * useCompletion() in shape (optimistic patch, server call, undo), but with
 * none of what a real completion does: no points, no crediting anyone, and
 * no row in task_completions - so it never touches the stats that are built
 * from that table.
 */
export function useSkip() {
  const { today, patchTask, reload } = useApp()
  const { t } = useI18n()
  const toast = useToast()

  /** Only ever offered for a recurring task - see TaskCard's onSkip wiring. */
  async function skip(task: Task): Promise<boolean> {
    const previousTask = { ...task }
    const outcome = planSkip(task, today)

    patchTask({
      ...task,
      due_date: outcome.nextDueDate ?? task.due_date,
      last_skipped_date: today,
      is_done: outcome.finished,
    })

    try {
      await api.skipTask(task.id, today)
      toast.show(t.task.skipped(task.title), {
        action: { label: t.common.undo, run: () => undo(task, { silent: true }) },
      })
      return true
    } catch (cause) {
      patchTask(previousTask)
      toast.showError(cause)
      void reload()
      return false
    }
  }

  async function undo(task: Task, options?: { silent?: boolean }) {
    try {
      const restored = await api.undoTaskSkip(task.id)
      patchTask(restored)
      if (!options?.silent) toast.show(t.task.skipUndone(task.title))
    } catch (cause) {
      toast.showError(cause)
      void reload()
    }
  }

  return { skip, undo }
}
