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
import { CheckIcon, ClockIcon, CopyIcon, PencilIcon, StarIcon, UndoIcon, XIcon } from './Icons'

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
  /** Calls off a time-limited task before its window closes on its own. */
  onCancel?: () => Promise<void>
  /** Opens a new-task form pre-filled from this one - only offered once a
   *  time-limited task is over, to do it again. */
  onDuplicate?: () => void
}

/**
 * One task, in whichever of its states it is in. The visual weight is
 * deliberately uneven: an overdue task should be impossible to miss, and one
 * already completed today should look closed rather than like another chore.
 *
 * The done/not-done toggle lives as a single leading checkbox - the same
 * shape as Todoist, Reminders and Google Tasks - rather than a pair of wide
 * trailing buttons. That was taking up to half the card's width on its own,
 * which is why long titles used to truncate so eagerly: the majority of a
 * list row belongs to its primary content, not its controls.
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
  onCancel,
  onDuplicate,
}: TaskCardProps) {
  const { t, language } = useI18n()
  const [busy, setBusy] = useState(false)
  const [justCompleted, setJustCompleted] = useState(false)
  const info = classify(task, today)

  const isChecked = info.status === 'completed_today' || info.status === 'done'
  // Undoing only ever applies the same day it happened - an older completion
  // stays checked, but settled, with nothing left to tap.
  const canCheck = !isChecked && Boolean(onComplete)
  const canUncheck = isChecked && info.status === 'completed_today' && Boolean(onUndo)

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

  async function toggle(event: React.MouseEvent<HTMLButtonElement>) {
    if (canCheck) return complete(event)
    if (canUncheck) return undo()
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

  async function cancelTask() {
    if (!onCancel || busy) return
    setBusy(true)
    try {
      await onCancel()
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
      {(onComplete || onUndo) && (
        <button
          type="button"
          className={`task-checkbox ${isChecked ? 'task-checkbox-checked' : ''}`}
          onClick={toggle}
          disabled={busy || (!canCheck && !canUncheck)}
          aria-pressed={isChecked}
          aria-label={isChecked ? t.task.unwaterAria(task.title) : t.task.completeAria(task.title)}
        >
          <span className="task-checkbox-circle">{isChecked && <CheckIcon size={15} />}</span>
        </button>
      )}

      <button type="button" className="task-main" onClick={onOpen} disabled={!onOpen}>
        <div className="task-headline">
          {/* A task's title can be Hebrew or English; plaintext lets each name
              read in its own natural direction inside an RTL interface. */}
          <h3 className="task-name">{task.title}</h3>
          {info.status === 'late' && (
            <span className="badge badge-late">{t.task.badgeLate(info.daysLate)}</span>
          )}
          {info.status === 'due' && <span className="badge badge-due">{t.task.badgeDue}</span>}
          {info.status === 'active' && <span className="badge badge-active">{t.task.badgeActive}</span>}
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
          ) : info.status === 'active' && task.expires_at ? (
            <span>{t.task.activeUntil(formatSnoozeUntil(task.expires_at, today, language))}</span>
          ) : info.status === 'scheduled' && task.starts_at ? (
            <span>{t.task.scheduledFor(formatSnoozeUntil(task.starts_at, today, language))}</span>
          ) : info.status === 'expired' ? (
            <span>
              {t.task.expiredAt(formatSnoozeUntil(task.expired_at ?? task.expires_at ?? today, today, language))}
            </span>
          ) : info.status === 'cancelled' ? (
            <span>{t.task.cancelledLabel}</span>
          ) : (
            <span>{t.task.dueOn(formatDate(task.due_date, language))}</span>
          )}
        </p>
      </button>

      {onSnooze && (
        <button
          type="button"
          className="icon-button"
          onClick={onSnooze}
          disabled={busy}
          aria-label={t.task.snoozeAria(task.title)}
        >
          <ClockIcon size={18} />
        </button>
      )}

      {onCancelSnooze && (
        <button
          type="button"
          className="icon-button"
          onClick={cancelSnooze}
          disabled={busy}
          aria-label={t.task.cancelSnoozeAria(task.title)}
        >
          <UndoIcon size={18} />
        </button>
      )}

      {onCancel && (
        <button
          type="button"
          className="icon-button"
          onClick={cancelTask}
          disabled={busy}
          aria-label={t.task.cancelAria(task.title)}
        >
          <XIcon size={17} />
        </button>
      )}

      {onDuplicate && (
        <button type="button" className="icon-button" onClick={onDuplicate} aria-label={t.task.duplicateAria(task.title)}>
          <CopyIcon size={17} />
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
