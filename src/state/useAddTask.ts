import * as api from '../lib/api'
import { useI18n } from '../lib/i18n'
import { useToast } from '../components/Toast'
import type { TaskDraft } from '../components/TaskForm'
import { useApp } from './AppState'

export function draftToNewTask(draft: TaskDraft, spaceId: string) {
  return {
    spaceId,
    title: draft.title,
    description: draft.description,
    taskType: draft.taskType,
    recurrenceMode: draft.recurrenceMode ?? undefined,
    intervalDays: draft.intervalDays,
    weeklyDays: draft.weeklyDays,
    endCondition: draft.endCondition,
    endAfterCount: draft.endAfterCount,
    endDate: draft.endDate,
    points: draft.points,
    reminderHour: draft.reminderHour,
    reminderMinute: draft.reminderMinute,
    dueDate: draft.dueDate,
    assignedTo: draft.assignedTo || null,
    startsAt: draft.startsAt,
    expiresAt: draft.expiresAt,
    reminderPolicy: draft.reminderPolicy,
  }
}

/** Creating a task in the current space - shared by the Tasks screen and the
 *  quick-add button on Today, so both notify an assignee the same way. */
export function useAddTask() {
  const { currentSpace, session, reload } = useApp()
  const { t } = useI18n()
  const toast = useToast()

  return async function addTask(draft: TaskDraft): Promise<void> {
    if (!session || !currentSpace) return
    const created = await api.createTask(draftToNewTask(draft, currentSpace.id), session.user.id)
    await reload()
    toast.show(t.tasks.added(draft.title.trim()))
    if (created.assigned_to && created.assigned_to !== session.user.id) {
      void api.notifyAssignment(created.id)
    }
  }
}
