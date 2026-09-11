import { describe, expect, it } from 'vitest'
import { planSnoozeOutcomes, type ExpiredSnooze, type SnoozeTask } from '../../supabase/functions/_shared/snoozeResend.ts'

const DISHES: SnoozeTask = {
  id: 'task-1',
  space_id: 'space-1',
  title: 'Dishes',
  task_type: 'recurring',
  recurrence_mode: 'interval',
  interval_days: 1,
  weekly_days: null,
  end_condition: 'never',
  end_after_count: null,
  end_date: null,
  occurrences_completed: 3,
  due_date: '2026-01-10',
  last_completed_date: null,
  is_done: false,
}

function tasksById(...tasks: SnoozeTask[]): Map<string, SnoozeTask> {
  return new Map(tasks.map((t) => [t.id, t]))
}

const alwaysToday = () => '2026-01-10'
const alwaysHebrew = () => 'he' as const

describe('planSnoozeOutcomes', () => {
  it('resends for a task that is still due', () => {
    const expired: ExpiredSnooze[] = [{ taskId: 'task-1', userId: 'user-1' }]
    const [outcome] = planSnoozeOutcomes(expired, tasksById(DISHES), alwaysToday, alwaysHebrew)

    expect(outcome.kind).toBe('resend')
    if (outcome.kind !== 'resend') throw new Error('unreachable')
    expect(outcome.taskId).toBe('task-1')
    expect(outcome.userId).toBe('user-1')
    expect(outcome.daysLate).toBe(0)
    expect(outcome.title).toContain('משימה אחת')
    expect(outcome.body).toContain('Dishes')
  })

  it('is stale once the task was completed in the meantime', () => {
    const completed: SnoozeTask = { ...DISHES, last_completed_date: '2026-01-10' }
    const expired: ExpiredSnooze[] = [{ taskId: 'task-1', userId: 'user-1' }]
    const [outcome] = planSnoozeOutcomes(expired, tasksById(completed), alwaysToday, alwaysHebrew)

    expect(outcome).toEqual({ kind: 'stale', taskId: 'task-1', userId: 'user-1' })
  })

  it('is stale once the task is finished for good (is_done)', () => {
    const done: SnoozeTask = { ...DISHES, is_done: true }
    const expired: ExpiredSnooze[] = [{ taskId: 'task-1', userId: 'user-1' }]
    const [outcome] = planSnoozeOutcomes(expired, tasksById(done), alwaysToday, alwaysHebrew)

    expect(outcome.kind).toBe('stale')
  })

  it('is stale once the task has been deleted', () => {
    const expired: ExpiredSnooze[] = [{ taskId: 'gone', userId: 'user-1' }]
    const [outcome] = planSnoozeOutcomes(expired, tasksById(DISHES), alwaysToday, alwaysHebrew)

    expect(outcome).toEqual({ kind: 'stale', taskId: 'gone', userId: 'user-1' })
  })

  it('is stale when the user has no profile to read a local date from', () => {
    const expired: ExpiredSnooze[] = [{ taskId: 'task-1', userId: 'ghost' }]
    const [outcome] = planSnoozeOutcomes(expired, tasksById(DISHES), () => null, alwaysHebrew)

    expect(outcome.kind).toBe('stale')
  })

  it("composes each resend in the resending user's own language", () => {
    const expired: ExpiredSnooze[] = [{ taskId: 'task-1', userId: 'user-1' }]
    const [outcome] = planSnoozeOutcomes(expired, tasksById(DISHES), alwaysToday, () => 'en')

    expect(outcome.kind).toBe('resend')
    if (outcome.kind !== 'resend') throw new Error('unreachable')
    expect(outcome.language).toBe('en')
    expect(outcome.title).toContain('1 task')
  })

  it('decides every snooze independently, in the same order given', () => {
    const laundry: SnoozeTask = { ...DISHES, id: 'task-2', title: 'Laundry', last_completed_date: '2026-01-10' }
    const expired: ExpiredSnooze[] = [
      { taskId: 'task-1', userId: 'user-1' },
      { taskId: 'task-2', userId: 'user-2' },
    ]
    const outcomes = planSnoozeOutcomes(expired, tasksById(DISHES, laundry), alwaysToday, alwaysHebrew)

    expect(outcomes).toHaveLength(2)
    expect(outcomes[0]).toMatchObject({ kind: 'resend', taskId: 'task-1' })
    expect(outcomes[1]).toMatchObject({ kind: 'stale', taskId: 'task-2' })
  })

  it('returns nothing for an empty list', () => {
    expect(planSnoozeOutcomes([], tasksById(DISHES), alwaysToday, alwaysHebrew)).toEqual([])
  })
})
