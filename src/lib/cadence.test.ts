import { describe, expect, it } from 'vitest'
import {
  completionTiming,
  median,
  planIntervalChange,
  suggestInterval,
  summarizeCadence,
  type CadenceTask,
  type TaskCadence,
} from './cadence'

const TODAY = '2026-10-10'

function task(overrides: Partial<CadenceTask> = {}): CadenceTask {
  return {
    id: 't', title: 'משימה', task_type: 'recurring', recurrence_mode: 'interval', interval_days: 7,
    weekly_days: null, due_date: '2026-10-17', is_done: false, last_completed_date: '2026-10-10', ...overrides,
  }
}

function cadence(overrides: Partial<TaskCadence> = {}): TaskCadence {
  return { taskId: 't', early: 0, onTime: 0, late: 0, skipped: 0, missed: 0, gaps: [], ...overrides }
}

describe('completionTiming', () => {
  const weekly = task()
  it('tells early, on time and late apart', () => {
    expect(completionTiming(weekly, '2026-10-10', '2026-10-08')).toBe('early')
    expect(completionTiming(weekly, '2026-10-10', '2026-10-10')).toBe('onTime')
    expect(completionTiming(weekly, '2026-10-10', '2026-10-12')).toBe('late')
  })
  it('reads a completion exactly a cycle on as on time - the miss before it is counted on its own', () => {
    expect(completionTiming(weekly, '2026-10-03', '2026-10-10')).toBe('onTime')
  })
})

describe('summarizeCadence', () => {
  it('counts each kind, a together completion once, and the misses in between', () => {
    const { total, byTask } = summarizeCadence(
      [task()],
      [
        { task_id: 't', completed_on: '2026-10-10', prev_due_date: '2026-09-26', completion_group: null },
        { task_id: 't', completed_on: '2026-09-24', prev_due_date: '2026-09-26', completion_group: 'g' },
        { task_id: 't', completed_on: '2026-09-24', prev_due_date: '2026-09-26', completion_group: 'g' },
      ],
      [{ task_id: 't', skipped_on: '2026-09-19', prev_due_date: '2026-09-19' }],
      TODAY,
      null,
    )
    // 26 Sep and 3 Oct went by; 10 Oct was done on its day.
    expect(total).toEqual({ early: 1, onTime: 1, late: 0, skipped: 1, missed: 2 })
    expect(byTask.get('t')?.gaps).toEqual([16])
  })

  it('counts only what falls in the range', () => {
    const { total } = summarizeCadence(
      [task()],
      [
        { task_id: 't', completed_on: '2026-10-10', prev_due_date: '2026-10-10', completion_group: null },
        { task_id: 't', completed_on: '2026-09-01', prev_due_date: '2026-09-01', completion_group: null },
      ],
      [],
      TODAY,
      '2026-10-01',
    )
    expect(total.onTime).toBe(1)
  })

  it('counts the open stretch as missed, unless the task is frozen for a vacation', () => {
    const overdue = task({ due_date: '2026-09-26' })
    expect(summarizeCadence([overdue], [], [], TODAY, null).total.missed).toBe(2)
    expect(summarizeCadence([overdue], [], [], TODAY, null, () => true).total.missed).toBe(0)
  })
})

describe('median', () => {
  it('is the middle value, or the mean of the middle two', () => {
    expect(median([5, 1, 3])).toBe(3)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([])).toBeNull()
  })
})

describe('suggestInterval', () => {
  it('suggests shortening a task mostly done early, at its real rhythm', () => {
    const suggestion = suggestInterval(task(), cadence({ early: 4, onTime: 1, gaps: [4, 5, 4, 5] }))
    expect(suggestion).toMatchObject({ direction: 'shorter', current: 7, suggested: 5 })
  })

  it('does not suggest shortening when the real rhythm is close to the set one', () => {
    expect(suggestInterval(task(), cadence({ early: 4, onTime: 1, gaps: [6, 6, 7, 6] }))).toBeNull()
  })

  it('suggests lengthening a task skipped or missed in a large share of cycles', () => {
    const suggestion = suggestInterval(task(), cadence({ onTime: 3, skipped: 1, missed: 2, gaps: [14, 12] }))
    expect(suggestion).toMatchObject({ direction: 'longer', current: 7, suggested: 13, dropped: 3, cycles: 6 })
  })

  it('lengthens at most to double, however rarely it was done', () => {
    expect(suggestInterval(task({ interval_days: 2 }), cadence({ onTime: 2, skipped: 3, missed: 2, gaps: [24] }))).toMatchObject({ suggested: 4 })
  })

  it('lengthens by half when there is no real rhythm to go by', () => {
    expect(suggestInterval(task({ interval_days: 4 }), cadence({ onTime: 1, missed: 4 }))).toMatchObject({ suggested: 6 })
    expect(suggestInterval(task({ interval_days: 1 }), cadence({ onTime: 1, missed: 4 }))).toMatchObject({ suggested: 2 })
  })

  it('waits for enough cycles before calling it a pattern', () => {
    expect(suggestInterval(task(), cadence({ early: 3, onTime: 1, gaps: [3, 3, 3] }))).toBeNull()
  })

  it('never suggests for fixed weekdays, one-time or finished tasks', () => {
    const lots = cadence({ missed: 9, onTime: 1 })
    expect(suggestInterval(task({ recurrence_mode: 'weekly_days', interval_days: null, weekly_days: [1] }), lots)).toBeNull()
    expect(suggestInterval(task({ task_type: 'one_time' }), lots)).toBeNull()
    expect(suggestInterval(task({ is_done: true }), lots)).toBeNull()
  })
})

describe('planIntervalChange', () => {
  it('moves the next time to the last completion plus the new interval', () => {
    expect(planIntervalChange(task(), 5, 7, TODAY)).toEqual({ interval_days: 5, due_date: '2026-10-15' })
    expect(planIntervalChange(task(), 10, 7, TODAY)).toEqual({ interval_days: 10, due_date: '2026-10-20' })
  })

  it('never makes a task late on the spot by shortening', () => {
    const doneLongAgo = task({ last_completed_date: '2026-10-01', due_date: '2026-10-15' })
    expect(planIntervalChange(doneLongAgo, 3, 14, TODAY).due_date).toBe(TODAY)
  })

  it('never pulls a lengthened task closer, nor a late one out of being late', () => {
    expect(planIntervalChange(task({ due_date: '2026-10-25' }), 9, 7, TODAY).due_date).toBe('2026-10-25')
    expect(planIntervalChange(task({ due_date: '2026-10-05', last_completed_date: '2026-09-28' }), 3, 7, TODAY).due_date).toBe('2026-10-05')
  })

  it('keeps the due date of a task never done', () => {
    expect(planIntervalChange(task({ last_completed_date: null }), 3, 7, TODAY).due_date).toBe('2026-10-17')
  })
})
