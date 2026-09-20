import { describe, expect, it } from 'vitest'
import {
  INACTIVE_THRESHOLD_DAYS,
  WEEKLY_TREND_WEEKS,
  busiestWeekday,
  dedupeCompletionGroups,
  inactiveMembers,
  mostNeglectedTask,
  onTimeRate,
  weeklyTrend,
} from './stats'
import type { StatsCompletion } from './api'

function completion(overrides: Partial<StatsCompletion> & { task_id: string; user_id: string }): StatsCompletion {
  return {
    points_awarded: 10,
    completed_on: '2026-01-15',
    created_at: '2026-01-15T08:00:00.000Z',
    prev_due_date: '2026-01-15',
    task: { title: 'task', task_type: 'recurring', recurrence_mode: null, interval_days: null, weekly_days: null },
    completion_group: null,
    ...overrides,
  }
}

describe('dedupeCompletionGroups', () => {
  it('keeps every ungrouped row', () => {
    const rows = [completion({ task_id: 'a', user_id: 'u1' }), completion({ task_id: 'b', user_id: 'u1' })]
    expect(dedupeCompletionGroups(rows)).toHaveLength(2)
  })

  it('keeps only the first row of a shared group', () => {
    const rows = [
      completion({ task_id: 'a', user_id: 'u1', completion_group: 'g1' }),
      completion({ task_id: 'a', user_id: 'u2', completion_group: 'g1' }),
    ]
    expect(dedupeCompletionGroups(rows)).toHaveLength(1)
  })
})

describe('weeklyTrend', () => {
  it('buckets into WEEKLY_TREND_WEEKS trailing 7-day windows, oldest first', () => {
    const today = '2026-01-29'
    const rows = [
      completion({ task_id: 'a', user_id: 'u1', completed_on: today }), // this week
      completion({ task_id: 'a', user_id: 'u1', completed_on: '2026-01-22' }), // 1 week ago
      completion({ task_id: 'a', user_id: 'u1', completed_on: '2026-12-01', points_awarded: 999 }), // way outside the window - dropped
    ]
    const buckets = weeklyTrend(rows, today)
    expect(buckets).toHaveLength(WEEKLY_TREND_WEEKS)
    expect(buckets[0].weeksAgo).toBe(WEEKLY_TREND_WEEKS - 1)
    expect(buckets.at(-1)).toEqual({ weeksAgo: 0, count: 1, points: 10 })
    expect(buckets.at(-2)).toEqual({ weeksAgo: 1, count: 1, points: 10 })
    expect(buckets.reduce((sum, b) => sum + b.count, 0)).toBe(2) // the out-of-window row never lands anywhere
  })

  it('counts a shared completion once for the household, not once per credited person', () => {
    const today = '2026-01-15'
    const rows = [
      completion({ task_id: 'a', user_id: 'u1', completed_on: today, completion_group: 'g1' }),
      completion({ task_id: 'a', user_id: 'u2', completed_on: today, completion_group: 'g1' }),
    ]
    const buckets = weeklyTrend(rows, today)
    expect(buckets.at(-1)?.count).toBe(1)
  })
})

describe('onTimeRate', () => {
  it('counts a completion on or before its due date as on time', () => {
    const rows = [completion({ task_id: 'a', user_id: 'u1', prev_due_date: '2026-01-15', completed_on: '2026-01-15' })]
    expect(onTimeRate(rows)).toEqual({ onTime: 1, late: 0, total: 1, percent: 100 })
  })

  it('counts a completion after its due date as late', () => {
    const rows = [completion({ task_id: 'a', user_id: 'u1', prev_due_date: '2026-01-10', completed_on: '2026-01-15' })]
    expect(onTimeRate(rows)).toEqual({ onTime: 0, late: 1, total: 1, percent: 0 })
  })

  it('excludes time-limited tasks - their due_date is not a real deadline', () => {
    const rows = [
      completion({
        task_id: 'a',
        user_id: 'u1',
        prev_due_date: '2026-01-01',
        completed_on: '2026-01-15',
        task: { title: 'window task', task_type: 'time_limited', recurrence_mode: null, interval_days: null, weekly_days: null },
      }),
    ]
    expect(onTimeRate(rows)).toEqual({ onTime: 0, late: 0, total: 0, percent: null })
  })

  it('returns a null percent when there is nothing to measure', () => {
    expect(onTimeRate([]).percent).toBeNull()
  })

  // A dishwasher every 2 days, completed exactly one full cycle after its due
  // date: nothing was actually neglected, since the next cycle had already
  // come around - so it counts as on time, not late.
  it('counts a recurring completion as on time once a full cycle has passed', () => {
    const rows = [
      completion({
        task_id: 'a',
        user_id: 'u1',
        prev_due_date: '2026-01-10',
        completed_on: '2026-01-12',
        task: { title: 'dishwasher', task_type: 'recurring', recurrence_mode: 'interval', interval_days: 2, weekly_days: null },
      }),
    ]
    expect(onTimeRate(rows)).toEqual({ onTime: 1, late: 0, total: 1, percent: 100 })
  })

  it('still counts a recurring completion late once part of another cycle has passed', () => {
    const rows = [
      completion({
        task_id: 'a',
        user_id: 'u1',
        prev_due_date: '2026-01-10',
        completed_on: '2026-01-15', // 5 days late on a 2-day cycle: half a cycle past the second one
        task: { title: 'dishwasher', task_type: 'recurring', recurrence_mode: 'interval', interval_days: 2, weekly_days: null },
      }),
    ]
    expect(onTimeRate(rows)).toEqual({ onTime: 0, late: 1, total: 1, percent: 0 })
  })
})

describe('mostNeglectedTask', () => {
  it('picks the task with the worst average lateness', () => {
    const rows = [
      // "task-late" averages 3 days late across 2 completions.
      completion({ task_id: 'task-late', user_id: 'u1', prev_due_date: '2026-01-01', completed_on: '2026-01-05' }),
      completion({ task_id: 'task-late', user_id: 'u1', prev_due_date: '2026-01-10', completed_on: '2026-01-11' }),
      // "task-ontime" is never late.
      completion({ task_id: 'task-ontime', user_id: 'u1', prev_due_date: '2026-01-01', completed_on: '2026-01-01' }),
      completion({ task_id: 'task-ontime', user_id: 'u1', prev_due_date: '2026-01-08', completed_on: '2026-01-08' }),
    ]
    expect(mostNeglectedTask(rows)).toMatchObject({ taskId: 'task-late', avgDaysLate: 2.5, count: 2 })
  })

  it('ignores a task completed fewer than twice, even if it was late', () => {
    const rows = [completion({ task_id: 'a', user_id: 'u1', prev_due_date: '2026-01-01', completed_on: '2026-01-10' })]
    expect(mostNeglectedTask(rows)).toBeNull()
  })

  it('returns null when nothing is ever late', () => {
    const rows = [
      completion({ task_id: 'a', user_id: 'u1', prev_due_date: '2026-01-01', completed_on: '2026-01-01' }),
      completion({ task_id: 'a', user_id: 'u1', prev_due_date: '2026-01-08', completed_on: '2026-01-08' }),
    ]
    expect(mostNeglectedTask(rows)).toBeNull()
  })

  it('measures average lateness wrapped to the task\'s own cycle, not the raw gap', () => {
    const cyclic = { title: 'dishwasher', task_type: 'recurring' as const, recurrence_mode: 'interval' as const, interval_days: 2, weekly_days: null }
    const rows = [
      // 5 days late on a 2-day cycle wraps to 1 (half the cycle), not 5.
      completion({ task_id: 'a', user_id: 'u1', prev_due_date: '2026-01-01', completed_on: '2026-01-06', task: cyclic }),
      // Exactly one cycle late wraps to 0.
      completion({ task_id: 'a', user_id: 'u1', prev_due_date: '2026-01-10', completed_on: '2026-01-12', task: cyclic }),
    ]
    expect(mostNeglectedTask(rows)).toMatchObject({ taskId: 'a', avgDaysLate: 0.5, count: 2 })
  })
})

describe('busiestWeekday', () => {
  it('finds the weekday with the most completions', () => {
    const rows = [
      completion({ task_id: 'a', user_id: 'u1', completed_on: '2026-01-15' }), // Thursday
      completion({ task_id: 'b', user_id: 'u1', completed_on: '2026-01-22' }), // Thursday
      completion({ task_id: 'c', user_id: 'u1', completed_on: '2026-01-17' }), // Saturday
    ]
    expect(busiestWeekday(rows)).toEqual({ weekday: 4, count: 2 })
  })

  it('returns null with no completions', () => {
    expect(busiestWeekday([])).toBeNull()
  })
})

describe('inactiveMembers', () => {
  const today = '2026-01-15'

  it('flags someone who has never completed anything', () => {
    const result = inactiveMembers(['u1', 'u2'], [completion({ task_id: 'a', user_id: 'u1', completed_on: today })], today)
    expect(result).toEqual([{ userId: 'u2', daysSinceLastCompletion: null }])
  })

  it('flags someone whose last completion is at or beyond the threshold', () => {
    const staleDate = new Date(Date.UTC(2026, 0, 15 - INACTIVE_THRESHOLD_DAYS)).toISOString().slice(0, 10)
    const rows = [completion({ task_id: 'a', user_id: 'u1', completed_on: staleDate })]
    expect(inactiveMembers(['u1'], rows, today)).toEqual([
      { userId: 'u1', daysSinceLastCompletion: INACTIVE_THRESHOLD_DAYS },
    ])
  })

  it('leaves out someone who completed something recently enough', () => {
    const rows = [completion({ task_id: 'a', user_id: 'u1', completed_on: today })]
    expect(inactiveMembers(['u1'], rows, today)).toEqual([])
  })

  it('sorts never-active ahead of the longest gap', () => {
    const rows = [completion({ task_id: 'a', user_id: 'u1', completed_on: '2026-01-01' })]
    const result = inactiveMembers(['u1', 'u2'], rows, today)
    expect(result.map((entry) => entry.userId)).toEqual(['u2', 'u1'])
  })
})
