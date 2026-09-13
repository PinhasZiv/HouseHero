import { useState } from 'react'
import { celebrateAt, failAt } from '../lib/celebrate'
import { classify } from '../lib/taskDue'
import {
  describeInterval,
  describeWeeklyDays,
  formatDate,
  formatSnoozeUntil,
  personLabel,
  relativeDay,
  type PersonLabel,
} from '../lib/format'
import { useI18n, type Language } from '../lib/i18n'
import type { Task } from '../lib/types'
import { CheckIcon, ClockIcon, PencilIcon, StarIcon, UndoIcon } from './Icons'

/** Who completed it: you, someone else by name, or nobody yet. */
export type CompletedBy = PersonLabel

interface TaskCardProps {
  task: Task
  today: string
  spaceName?: string
  completedBy?: CompletedBy
  assignedName?: string | null
  /** Resolves to false (rather than throwing) when the completion failed - the
   *  card celebrates only on true, and shows a failure mark otherwise. */
  onComplete?: () => Promise<boolean | void>
  /**
   * The caller decides whether to offer this - based on whether the task was
   * actually completed by whoever is looking at the screen right now. The
   * server enforces the same check regardless, so this only affects when the
   * action is offered, not who is allowed to use it.
   */
  onUndo?: () => Promise<void>
  /** Tapping the card body - opens its completion history. */
  onOpen?: () => void
  /** A small separate edit button - only shown in the full "Tasks" list. */
  onEdit?: () => void
  /** ISO instant this person's own snooze on this task runs out. */
  snoozedUntil?: string
  onSnooze?: () => void
  onCancelSnooze?: () => Promise<void>
}

/**
 * One task, in whichever of its states it is in. The visual weight is
 * deliberately uneven: an overdue task should be impossible to miss, and one
 * already completed today should look closed rather than like another chore.
 */
export function TaskCard({
  task,
  today,
  spaceName,
  completedBy,
  assignedName,
  onComplete,
  onUndo,
  onOpen,
  onEdit,
  snoozedUntil,
  onSnooze,
  onCancelSnooze,
}: TaskCardProps) {
  const { t, language } = useI18n()
  const [busy, setBusy] = useState(false)
  const [justCompleted, setJustCompleted] = useState(false)
  const info = classify(task, today)

  async function complete(event: React.MouseEvent<HTMLButtonElement>) {
    if (!onComplete || busy) return
    const rect = event.currentTarget.getBoundingClientRect()
    // A keyboard-triggered click carries clientX/clientY of 0 rather than a
    // real tap position, so the effect falls back to the button's own center.
    const x = event.clientX || rect.left + rect.width / 2
    const y = event.clientY || rect.top + rect.height / 2
    setBusy(true)
    try {
      const ok = await onComplete()
      if (ok === true) {
        setJustCompleted(true)
        celebrateAt(x, y, task.points)
      } else if (ok === false) {
        failAt(x, y)
      }
      // ok === undefined: the "who did this?" picker was opened and then
      // cancelled - nothing happened, so no celebration and no failure mark.
    } finally {
      setBusy(false)
    }
  }

  async function undo() {
    if (!onUndo || busy) return
    setBusy(true)
    try {
      await onUndo()
    } finally {
      setBusy(false)
    }
  }

  async function cancelSnooze() {
    if (!onCancelSnooze || busy) return
    setBusy(true)
    try {
      await onCancelSnooze()
    } finally {
      setBusy(false)
    }
  }

  const recurrenceLabel =
    task.task_type === 'recurring'
      ? task.recurrence_mode === 'weekly_days'
        ? describeWeeklyDays(task.weekly_days ?? [], language)
        : describeInterval(task.interval_days ?? 1, language)
      : null

  return (
    <article className={`task-card task-${info.status} ${justCompleted ? 'task-just-completed' : ''}`}>
      <button type="button" className="task-main" onClick={onOpen} disabled={!onOpen}>
        <div className="task-headline">
          {/* A task's title can be Hebrew or English; plaintext lets each name
              read in its own natural direction inside an RTL interface. */}
          <h3 className="task-name">{task.title}</h3>
          {info.status === 'late' && (
            <span className="badge badge-late">{t.task.badgeLate(info.daysLate)}</span>
          )}
          {info.status === 'due' && <span className="badge badge-due">{t.task.badgeDue}</span>}
          {info.status === 'completed_today' && (
            <span className="badge badge-done">
              <CheckIcon size={14} /> {t.task.badgeDone}
            </span>
          )}
          <span className="badge badge-points">
            <StarIcon size={12} /> {t.task.pointsBadge(task.points)}
          </span>
        </div>

        <p className="task-meta">
          {spaceName && <span className="chip">{spaceName}</span>}
          {recurrenceLabel && <span>{recurrenceLabel}</span>}
          {assignedName && <span className="chip chip-assign">{assignedName}</span>}
          {snoozedUntil ? (
            <span>{t.task.snoozedUntil(formatSnoozeUntil(snoozedUntil, today, language))}</span>
          ) : info.status === 'completed_today' ? (
            <>
              <span>
                {!completedBy || completedBy.kind === 'you'
                  ? t.task.completedByYou
                  : completedBy.kind === 'group'
                    ? t.task.completedByGroup(completedBy.count)
                    : t.task.completedBy(completedBy.name ?? t.task.someoneElse)}
              </span>
              {task.task_type === 'recurring' && !task.is_done && (
                <span>{t.task.nextIn(relativeDay(task.due_date, today, language))}</span>
              )}
            </>
          ) : (
            <span>{t.task.dueOn(formatDate(task.due_date, language))}</span>
          )}
        </p>
      </button>

      {onComplete && info.status !== 'completed_today' && (
        <button
          type="button"
          className="complete-button"
          onClick={complete}
          disabled={busy}
          aria-label={t.task.completeAria(task.title)}
        >
          <CheckIcon size={20} />
          <span>{busy ? '...' : t.task.complete}</span>
        </button>
      )}

      {onUndo && info.status === 'completed_today' && (
        <button
          type="button"
          className="complete-button complete-button-muted"
          onClick={undo}
          disabled={busy}
          aria-label={t.task.unwaterAria(task.title)}
        >
          <UndoIcon size={20} />
          <span>{busy ? '...' : t.task.undoCompletion}</span>
        </button>
      )}

      {onSnooze && (
        <button
          type="button"
          className="complete-button complete-button-muted"
          onClick={onSnooze}
          disabled={busy}
          aria-label={t.task.snoozeAria(task.title)}
        >
          <ClockIcon size={20} />
          <span>{t.task.snooze}</span>
        </button>
      )}

      {onCancelSnooze && (
        <button
          type="button"
          className="complete-button complete-button-muted"
          onClick={cancelSnooze}
          disabled={busy}
          aria-label={t.task.cancelSnoozeAria(task.title)}
        >
          <UndoIcon size={20} />
          <span>{busy ? '...' : t.task.cancelSnooze}</span>
        </button>
      )}

      {onEdit && (
        <button type="button" className="icon-button" onClick={onEdit} aria-label={t.task.editAria(task.title)}>
          <PencilIcon size={17} />
        </button>
      )}
    </article>
  )
}

export function completedByLabel(
  task: Task,
  people: Map<string, { display_name: string | null; email: string | null }>,
  selfId: string | null,
  language: Language,
): CompletedBy {
  const ids = task.last_completed_by ?? []
  if (ids.length === 0) return null
  if (ids.length > 1) return { kind: 'group', count: ids.length }
  return personLabel(ids[0], people, selfId, language)
}
