import { useEffect, useMemo, useState } from 'react'
import * as api from '../lib/api'
import type { CompletionChoice } from '../lib/api'
import { classify, compareByCompletion, compareBySchedule } from '../lib/taskDue'
import { useApp } from '../state/AppState'
import { useCompletion } from '../state/useCompletion'
import { CompletionSheet } from './CompletionSheet'
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
    startsAt: draft.startsAt,
    expiresAt: draft.expiresAt,
    reminderPolicy: draft.reminderPolicy,
  }
}

type OwnerFilter = 'all' | 'mine' | 'everyone' | 'others'

/** Every task in the selected space, whether or not it needs anything today. */
export function TasksScreen() {
  const { tasks, currentSpace, today, session, people, reload, patchTask, removeTask } = useApp()
  const { t, language } = useI18n()
  const { complete, undo } = useCompletion()
  const toast = useToast()
  const [members, setMembers] = useState<Member[]>([])
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Task | null>(null)
  const [duplicating, setDuplicating] = useState<Task | null>(null)
  const [viewingHistory, setViewingHistory] = useState<Task | null>(null)
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>('all')
  const [completing, setCompleting] = useState<{
    task: Task
    resolve: (result: boolean | void) => void
  } | null>(null)

  // A time-limited task's status turns on the clock, not just the calendar
  // day - without this, "scheduled" would only ever become "active" (or
  // "active" become "expired") after some unrelated re-render happened to
  // fire.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const interval = window.setInterval(() => setTick((n) => n + 1), 60_000)
    return () => window.clearInterval(interval)
  }, [])

  /** Opens the "who did this?" picker and resolves once a choice is made
   *  (or the sheet is dismissed, resolving to undefined - a no-op). */
  function requestComplete(task: Task): Promise<boolean | void> {
    return new Promise((resolve) => setCompleting({ task, resolve }))
  }

  async function chooseCompletion(choice: CompletionChoice) {
    if (!completing) return
    const ok = await complete(completing.task, choice)
    completing.resolve(ok)
    setCompleting(null)
  }

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

  // A time-limited task inside its window right now outranks everything else
  // open - it is relevant for a bounded stretch of time, not just "sometime
  // today" - then late/due, then whatever is not due yet.
  function priorityTier(task: Task): number {
    const status = classify(task, today).status
    if (status === 'active') return 0
    if (status === 'upcoming' || status === 'scheduled') return 2
    return 1
  }

  // Completed tasks (finished for good, or a recurring task just done today)
  // sink below every open task - late and due alike - into their own section
  // at the bottom, since what still needs doing matters more than a record
  // of what's already handled.
  const { openTasks, completedTasks } = useMemo(() => {
    const open: Task[] = []
    const completed: Task[] = []
    for (const task of tasks) {
      if (task.space_id !== currentSpace?.id) continue
      const status = classify(task, today).status
      // A time-limited task can read as expired client-side well before the
      // periodic sweep sets is_done - it belongs in the record the moment
      // its window closes, not up to 15 minutes later.
      if (task.is_done || status === 'completed_today' || status === 'expired' || status === 'cancelled') {
        completed.push(task)
      } else {
        open.push(task)
      }
    }
    open.sort((a, b) => {
      const byTier = priorityTier(a) - priorityTier(b)
      return byTier !== 0 ? byTier : compareBySchedule(a, b)
    })
    completed.sort(compareByCompletion)
    return { openTasks: open, completedTasks: completed }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, currentSpace, today, tick])

  const spaceTasks = useMemo(() => [...openTasks, ...completedTasks], [openTasks, completedTasks])

  const ownerGroups = useMemo(() => {
    const mine: Task[] = []
    const everyone: Task[] = []
    const others: Task[] = []
    for (const task of openTasks) {
      if (!task.assigned_to) everyone.push(task)
      else if (task.assigned_to === session?.user.id) mine.push(task)
      else others.push(task)
    }
    return { mine, everyone, others }
  }, [openTasks, session])


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
    // Converting an already-completed recurring task to one_time/time_limited
    // must not silently reopen it - those types have only a single
    // completion to give, and it already happened under the recurring
    // identity, even though completing it never touched is_done (a
    // recurring task's own completion just advances due_date instead).
    const wasRecurring = editing.task_type === 'recurring'
    const alreadyFinished =
      wasRecurring && draft.taskType !== 'recurring' && editing.occurrences_completed > 0
    const updated = await api.updateTask(editing.id, {
      ...draftToNewTask(draft, currentSpace!.id),
      alreadyFinished,
    })
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

  async function cancelTaskAction(task: Task) {
    const updated = await api.cancelTask(task.id)
    patchTask(updated)
  }

  function assignedName(task: Task): string | null {
    if (!task.assigned_to) return null
    if (task.assigned_to === session?.user.id) return t.task.assignedToYou
    const person = people.get(task.assigned_to)
    return t.task.assignedTo(person?.display_name || person?.email || t.task.someoneElse)
  }

  // Whoever was credited can undo, same as always; so can whoever actually
  // tapped Done, even when they credited someone else instead.
  function canUndo(task: Task): boolean {
    const selfId = session?.user.id ?? null
    return (selfId !== null && (task.last_completed_by ?? []).includes(selfId)) || task.last_completed_actor === selfId
  }

  function renderCard(task: Task) {
    return (
      <TaskCard
        key={task.id}
        task={task}
        today={today}
        assignedName={assignedName(task)}
        completedBy={completedByLabel(task, people, session?.user.id ?? null, language)}
        onComplete={!task.is_done ? () => requestComplete(task) : undefined}
        onUndo={canUndo(task) ? () => undo(task) : undefined}
        onCancel={
          task.task_type === 'time_limited' && !task.is_done ? () => cancelTaskAction(task) : undefined
        }
        onDuplicate={
          task.task_type === 'time_limited' && task.is_done ? () => setDuplicating(task) : undefined
        }
        onOpen={() => setViewingHistory(task)}
        onEdit={() => setEditing(task)}
      />
    )
  }

  // The "others" filter only earns its own tab once it can ever hold
  // something - in a two-person space every task is either mine or
  // everyone's, so a permanently-empty tab would just be clutter.
  const hasOthers = ownerGroups.others.length > 0
  const showMine = ownerFilter === 'all' || ownerFilter === 'mine'
  const showEveryone = ownerFilter === 'all' || ownerFilter === 'everyone'
  const showOthers = ownerFilter === 'all' || ownerFilter === 'others'
  const visibleCount =
    (showMine ? ownerGroups.mine.length : 0) +
    (showEveryone ? ownerGroups.everyone.length : 0) +
    (showOthers ? ownerGroups.others.length : 0)

  const completedVisible = completedTasks.filter((task) => {
    if (ownerFilter === 'all') return true
    if (ownerFilter === 'mine') return task.assigned_to === session?.user.id
    if (ownerFilter === 'everyone') return !task.assigned_to
    return !!task.assigned_to && task.assigned_to !== session?.user.id
  })

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
        <>
          <div className="segmented owner-filter" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={ownerFilter === 'all'}
              className={ownerFilter === 'all' ? 'segment segment-active' : 'segment'}
              onClick={() => setOwnerFilter('all')}
            >
              {t.tasks.filterAll}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={ownerFilter === 'mine'}
              className={ownerFilter === 'mine' ? 'segment segment-active' : 'segment'}
              onClick={() => setOwnerFilter('mine')}
            >
              {t.tasks.filterMine}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={ownerFilter === 'everyone'}
              className={ownerFilter === 'everyone' ? 'segment segment-active' : 'segment'}
              onClick={() => setOwnerFilter('everyone')}
            >
              {t.tasks.filterEveryone}
            </button>
            {hasOthers && (
              <button
                type="button"
                role="tab"
                aria-selected={ownerFilter === 'others'}
                className={ownerFilter === 'others' ? 'segment segment-active' : 'segment'}
                onClick={() => setOwnerFilter('others')}
              >
                {t.tasks.filterOthers}
              </button>
            )}
          </div>

          {showMine && ownerGroups.mine.length > 0 && (
            <section className="task-group">
              {ownerFilter === 'all' && <h3 className="group-title">{t.tasks.groupMine}</h3>}
              {ownerGroups.mine.map(renderCard)}
            </section>
          )}

          {showEveryone && ownerGroups.everyone.length > 0 && (
            <section className="task-group">
              {ownerFilter === 'all' && <h3 className="group-title">{t.tasks.groupEveryone}</h3>}
              {ownerGroups.everyone.map(renderCard)}
            </section>
          )}

          {showOthers && ownerGroups.others.length > 0 && (
            <section className="task-group">
              {ownerFilter === 'all' && <h3 className="group-title">{t.tasks.groupOthers}</h3>}
              {ownerGroups.others.map(renderCard)}
            </section>
          )}

          {completedVisible.length > 0 && (
            <details className="task-group completed-group">
              <summary className="group-title completed-summary">
                {t.tasks.groupCompleted(completedVisible.length)}
              </summary>
              {completedVisible.map(renderCard)}
            </details>
          )}

          {visibleCount === 0 && completedVisible.length === 0 && (
            <div className="empty-state">
              <p>{t.tasks.empty}</p>
            </div>
          )}
        </>
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
      {duplicating && (
        <TaskForm
          today={today}
          duplicateFrom={duplicating}
          members={members}
          onCancel={() => setDuplicating(null)}
          onSave={async (draft) => {
            await addTask(draft)
            setDuplicating(null)
          }}
        />
      )}
      {viewingHistory && <TaskHistory task={viewingHistory} onClose={() => setViewingHistory(null)} />}

      {completing && session && (
        <CompletionSheet
          task={completing.task}
          selfId={session.user.id}
          onChoose={chooseCompletion}
          onClose={() => {
            completing.resolve(undefined)
            setCompleting(null)
          }}
        />
      )}
    </div>
  )
}
