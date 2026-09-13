import { useEffect, useMemo, useState } from 'react'
import type { CompletionChoice } from '../lib/api'
import { classify } from '../lib/taskDue'
import { useApp } from '../state/AppState'
import { useSnooze } from '../state/useSnooze'
import { useCompletion } from '../state/useCompletion'
import { CompletionSheet } from './CompletionSheet'
import { TaskCard, completedByLabel } from './TaskCard'
import { TaskHistory } from './TaskHistory'
import { SnoozeSheet } from './SnoozeSheet'
import { useI18n } from '../lib/i18n'
import type { Task } from '../lib/types'

/** How often to re-check whether a snooze has run out while the screen is open. */
const SNOOZE_TICK_MS = 30_000

/** Consumes the one-shot `?snooze=1` a notification's Snooze action opens the
 * app with, so a later reload does not reopen the sheet. */
function consumeSnoozeFlag(): boolean {
  const params = new URLSearchParams(window.location.search)
  if (params.get('snooze') !== '1') return false
  params.delete('snooze')
  const rest = params.toString()
  window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''))
  return true
}

/**
 * The screen a notification opens: what needs doing today, across every space
 * the person belongs to.
 *
 * Deliberately not limited to one space - a task's reminder counts every
 * space together, so a list scoped to only the selected space would
 * contradict the notification that led here.
 */
export function TodayScreen({ onManageTasks }: { onManageTasks: () => void }) {
  const { tasks, spaces, people, today, session, snoozes } = useApp()
  const { t, language } = useI18n()
  const { complete, undo } = useCompletion()
  const { snooze, cancelSnooze } = useSnooze()
  const selfId = session?.user.id ?? null

  const [sheetTargets, setSheetTargets] = useState<Task[] | null>(null)
  const [viewingHistory, setViewingHistory] = useState<Task | null>(null)
  const [completing, setCompleting] = useState<{
    task: Task
    resolve: (result: boolean | void) => void
  } | null>(null)

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

  // A snoozed task should come back on its own the moment the timer runs out,
  // without waiting for a navigation or a reload to force a re-render.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const interval = window.setInterval(() => setTick((n) => n + 1), SNOOZE_TICK_MS)
    return () => window.clearInterval(interval)
  }, [])

  const groups = useMemo(() => {
    const late: Task[] = []
    const due: Task[] = []
    const done: Task[] = []
    const snoozed: { task: Task; until: string }[] = []

    for (const task of tasks) {
      const { status } = classify(task, today)
      const until = snoozes.get(task.id)
      const stillSnoozed = (status === 'late' || status === 'due') && until && new Date(until) > new Date()

      if (stillSnoozed) snoozed.push({ task, until: until as string })
      else if (status === 'late') late.push(task)
      else if (status === 'due') due.push(task)
      else if (status === 'completed_today') done.push(task)
    }

    // Worst overdue first within the late group; snoozed by soonest return.
    late.sort((a, b) => classify(b, today).daysLate - classify(a, today).daysLate)
    snoozed.sort((a, b) => a.until.localeCompare(b.until))
    return { late, due, done, snoozed }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, today, snoozes, tick])

  // The Snooze action on a notification opens here with ?snooze=1: there is
  // no single task to point at (the notification can cover several), so it
  // opens the picker on everything actually due right now.
  useEffect(() => {
    if (!consumeSnoozeFlag()) return
    const targets = [...groups.late, ...groups.due]
    if (targets.length > 0) setSheetTargets(targets)
    // Deliberately mount-only: re-running whenever groups change would
    // reopen the sheet after the person closes it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const spaceNames = useMemo(() => new Map(spaces.map((space) => [space.id, space.name])), [spaces])
  const showSpaceNames = spaces.length > 1

  // Whoever was credited can undo, same as always; so can whoever actually
  // tapped Done, even when they credited someone else - and if it was
  // completed together, everyone was credited, so everyone can undo it.
  function canUndo(task: Task): boolean {
    return (selfId !== null && (task.last_completed_by ?? []).includes(selfId)) || task.last_completed_actor === selfId
  }

  function assignedName(task: Task): string | null {
    if (!task.assigned_to) return null
    if (task.assigned_to === selfId) return t.task.assignedToYou
    const person = people.get(task.assigned_to)
    return t.task.assignedTo(person?.display_name || person?.email || t.task.someoneElse)
  }

  const remaining = groups.late.length + groups.due.length

  if (tasks.length === 0) {
    return (
      <div className="empty-state fade-in">
        <h2>{t.today.emptyTitle}</h2>
        <p>{t.today.emptyBody}</p>
        <button type="button" className="btn btn-primary" onClick={onManageTasks}>
          {t.today.addTask}
        </button>
      </div>
    )
  }

  return (
    <div className="screen fade-in">
      <header className="screen-header">
        <h2>{remaining > 0 ? t.today.titleActive : t.today.titleDone}</h2>
        <p className="screen-subtitle">
          {remaining > 0
            ? t.today.needsAction(remaining)
            : groups.snoozed.length > 0
              ? t.today.someSnoozed(groups.snoozed.length)
              : groups.done.length > 0
                ? t.today.allDone
                : t.today.nothingDue}
        </p>
      </header>

      {groups.late.length > 0 && (
        <section className="task-group">
          <h3 className="group-title group-title-late">{t.today.groupLate}</h3>
          {groups.late.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              today={today}
              spaceName={showSpaceNames ? spaceNames.get(task.space_id) : undefined}
              assignedName={assignedName(task)}
              onComplete={() => requestComplete(task)}
              onSnooze={() => setSheetTargets([task])}
              onOpen={() => setViewingHistory(task)}
            />
          ))}
        </section>
      )}

      {groups.due.length > 0 && (
        <section className="task-group">
          <h3 className="group-title">{t.today.groupDue}</h3>
          {groups.due.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              today={today}
              spaceName={showSpaceNames ? spaceNames.get(task.space_id) : undefined}
              assignedName={assignedName(task)}
              onComplete={() => requestComplete(task)}
              onSnooze={() => setSheetTargets([task])}
              onOpen={() => setViewingHistory(task)}
            />
          ))}
        </section>
      )}

      {groups.snoozed.length > 0 && (
        <section className="task-group">
          <h3 className="group-title">{t.today.groupSnoozed}</h3>
          {groups.snoozed.map(({ task, until }) => (
            <TaskCard
              key={task.id}
              task={task}
              today={today}
              spaceName={showSpaceNames ? spaceNames.get(task.space_id) : undefined}
              assignedName={assignedName(task)}
              snoozedUntil={until}
              onComplete={() => requestComplete(task)}
              onCancelSnooze={() => cancelSnooze(task)}
              onOpen={() => setViewingHistory(task)}
            />
          ))}
        </section>
      )}

      {groups.done.length > 0 && (
        <section className="task-group">
          {/* Stays on screen for the rest of the day, so a second person
              opening the app sees it was handled, not an unexplained gap. */}
          <h3 className="group-title">{t.today.groupDone}</h3>
          {groups.done.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              today={today}
              spaceName={showSpaceNames ? spaceNames.get(task.space_id) : undefined}
              completedBy={completedByLabel(task, people, selfId, language)}
              onUndo={canUndo(task) ? () => undo(task) : undefined}
              onOpen={() => setViewingHistory(task)}
            />
          ))}
        </section>
      )}

      {sheetTargets && (
        <SnoozeSheet
          tasks={sheetTargets}
          onClose={() => setSheetTargets(null)}
          onConfirm={async (until) => {
            await snooze(sheetTargets, until)
            setSheetTargets(null)
          }}
        />
      )}

      {viewingHistory && <TaskHistory task={viewingHistory} onClose={() => setViewingHistory(null)} />}

      {completing && selfId && (
        <CompletionSheet
          task={completing.task}
          selfId={selfId}
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
