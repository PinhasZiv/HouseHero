import { useEffect, useMemo, useState } from 'react'
import * as api from '../lib/api'
import { classify } from '../lib/taskDue'
import { useApp } from '../state/AppState'
import { useCompletion } from '../state/useCompletion'
import { TaskCard, completedByLabel } from './TaskCard'
import { TaskForm, type TaskDraft } from './TaskForm'
import { TaskHistory } from './TaskHistory'
import { PlusIcon } from './Icons'
import { useToast } from './Toast'
import { useI18n } from '../lib/i18n'
import type { Member, Task } from '../lib/types'

function draftToNewTask(draft: TaskDraft, spaceId: string) {
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
  }
}

/** Every task in the selected space, whether or not it needs anything today. */
export function TasksScreen() {
  const { tasks, currentSpace, today, session, people, reload, patchTask, removeTask } = useApp()
  const { t, language } = useI18n()
  const { complete, undo } = useCompletion()
  const toast = useToast()
  const [members, setMembers] = useState<Member[]>([])
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Task | null>(null)
  const [viewingHistory, setViewingHistory] = useState<Task | null>(null)

  useEffect(() => {
    if (!currentSpace) return
    let cancelled = false
    api
      .fetchMembers(currentSpace.id)
      .then((rows) => {
        if (!cancelled) setMembers(rows)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [currentSpace])

  const spaceTasks = useMemo(
    () =>
      tasks
        .filter((task) => task.space_id === currentSpace?.id)
        .sort((a, b) => {
          // Anything needing attention rises to the top; the rest by due date.
          const aActive = classify(a, today).status !== 'upcoming' && !a.is_done
          const bActive = classify(b, today).status !== 'upcoming' && !b.is_done
          if (aActive !== bActive) return aActive ? -1 : 1
          if (a.is_done !== b.is_done) return a.is_done ? 1 : -1
          return a.due_date.localeCompare(b.due_date)
        }),
    [tasks, currentSpace, today],
  )

  if (!currentSpace) return null

  async function addTask(draft: TaskDraft) {
    if (!session) return
    const created = await api.createTask(draftToNewTask(draft, currentSpace!.id), session.user.id)
    setAdding(false)
    await reload()
    toast.show(t.tasks.added(draft.title.trim()))
    if (created.assigned_to && created.assigned_to !== session.user.id) {
      void api.notifyAssignment(created.id)
    }
  }

  async function saveTask(draft: TaskDraft) {
    if (!editing) return
    const previousAssignee = editing.assigned_to
    const updated = await api.updateTask(editing.id, draftToNewTask(draft, currentSpace!.id))
    patchTask(updated)
    setEditing(null)
    // Only a genuinely new assignment to someone else notifies - not every
    // edit of an already-assigned task, and never for assigning it to
    // yourself.
    if (
      updated.assigned_to &&
      updated.assigned_to !== previousAssignee &&
      updated.assigned_to !== session?.user.id
    ) {
      void api.notifyAssignment(updated.id)
    }
  }

  async function removeTaskAction() {
    if (!editing) return
    await api.deleteTask(editing.id)
    removeTask(editing.id)
    setEditing(null)
    toast.show(t.tasks.deleted)
  }

  function assignedName(task: Task): string | null {
    if (!task.assigned_to) return null
    if (task.assigned_to === session?.user.id) return t.task.assignedToYou
    const person = people.get(task.assigned_to)
    return t.task.assignedTo(person?.display_name || person?.email || t.task.someoneElse)
  }

  return (
    <div className="screen fade-in">
      <header className="screen-header">
        <h2>{currentSpace.name}</h2>
        <p className="screen-subtitle">
          {spaceTasks.length === 0 ? t.tasks.empty : t.tasks.count(spaceTasks.length)}
        </p>
      </header>

      {spaceTasks.length === 0 ? (
        <div className="empty-state">
          <p>{t.tasks.emptyBody}</p>
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            {t.tasks.addFirst}
          </button>
        </div>
      ) : (
        <section className="task-group">
          {spaceTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              today={today}
              assignedName={assignedName(task)}
              completedBy={completedByLabel(task, people, session?.user.id ?? null, language)}
              onComplete={!task.is_done ? () => complete(task) : undefined}
              onUndo={task.last_completed_by === session?.user.id ? () => undo(task) : undefined}
              onOpen={() => setViewingHistory(task)}
              onEdit={() => setEditing(task)}
            />
          ))}
        </section>
      )}

      <button type="button" className="fab" onClick={() => setAdding(true)} aria-label={t.tasks.addAria}>
        <PlusIcon size={24} />
      </button>

      {adding && (
        <TaskForm today={today} members={members} onCancel={() => setAdding(false)} onSave={addTask} />
      )}
      {editing && (
        <TaskForm
          today={today}
          existing={editing}
          members={members}
          onCancel={() => setEditing(null)}
          onSave={saveTask}
          onDelete={removeTaskAction}
        />
      )}
      {viewingHistory && <TaskHistory task={viewingHistory} onClose={() => setViewingHistory(null)} />}
    </div>
  )
}
