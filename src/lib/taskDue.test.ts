import { describe, expect, it } from 'vitest'
import {
  actionable,
  addDays,
  classify,
  cycleLateness,
  daysBetween,
  formatTimeIn,
  minutesOfDayIn,
  nextWeeklyDate,
  notifiable,
  planCompletion,
  todayIn,
  type CyclicTask,
  type DueTask,
} from './taskDue'

function task(overrides: Partial<DueTask> = {}): DueTask {
  return {
    task_type: 'recurring',
    recurrence_mode: 'interval',
    interval_days: 7,
    weekly_days: null,
    end_condition: 'never',
    end_after_count: null,
    end_date: null,
    occurrences_completed: 0,
    due_date: '2026-05-10',
    last_completed_date: null,
    is_done: false,
    starts_at: null,
    expires_at: null,
    cancelled_at: null,
    expired_at: null,
    ...overrides,
  }
}

describe('date arithmetic', () => {
  it('counts whole days between dates', () => {
    expect(daysBetween('2026-03-01', '2026-03-08')).toBe(7)
    expect(daysBetween('2026-03-08', '2026-03-01')).toBe(-7)
    expect(daysBetween('2026-03-01', '2026-03-01')).toBe(0)
  })

  it('crosses month and year boundaries', () => {
    expect(daysBetween('2026-12-28', '2027-01-04')).toBe(7)
    expect(addDays('2026-12-28', 7)).toBe('2027-01-04')
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
  })

  it('handles leap days', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2)
  })

  // The whole point of storing dates rather than timestamps: a DST shift must
  // not silently turn one day into two, or none.
  it('is immune to daylight-saving shifts', () => {
    expect(daysBetween('2026-03-27', '2026-03-30')).toBe(3)
    expect(daysBetween('2026-10-24', '2026-10-27')).toBe(3)
  })
})

describe('classify', () => {
  it('marks a task due on its due date', () => {
    const info = classify(task({ due_date: '2026-05-10' }), '2026-05-10')
    expect(info.status).toBe('due')
    expect(info.daysLate).toBe(0)
    expect(info.notifiable).toBe(true)
  })

  it('marks a task upcoming before its due date', () => {
    const info = classify(task({ due_date: '2026-05-10' }), '2026-05-08')
    expect(info.status).toBe('upcoming')
    expect(info.notifiable).toBe(false)
  })

  it('counts lateness in days', () => {
    const t = task({ due_date: '2026-05-10' })
    expect(classify(t, '2026-05-11').daysLate).toBe(1)
    expect(classify(t, '2026-05-13').daysLate).toBe(3)
    expect(classify(t, '2026-05-11').status).toBe('late')
  })

  // Different from PlantShare's plants: a task never stops nagging just
  // because it has been late for a while - only completing it (or deleting
  // it) silences the reminder.
  it('never stops notifying no matter how many days overdue', () => {
    const t = task({ due_date: '2026-05-10' })
    for (const late of [1, 3, 10, 60]) {
      const info = classify(t, addDays('2026-05-10', late))
      expect(info.notifiable).toBe(true)
      expect(info.status).toBe('late')
    }
  })

  // A dishwasher every two days: skipping one cycle entirely means it was not
  // needed, so exactly one interval late reads as "due", not "late" - but
  // still notifiable, since it is due again right now.
  it('wraps an interval task to "due" once exactly one full cycle has passed', () => {
    const t = task({ recurrence_mode: 'interval', interval_days: 2, due_date: '2026-05-10' })
    const info = classify(t, '2026-05-12')
    expect(info.status).toBe('due')
    expect(info.daysLate).toBe(0)
    expect(info.notifiable).toBe(true)
  })

  it('wraps an interval task\'s lateness to the most recent cycle - 2.5 cycles late reads as half a cycle', () => {
    const t = task({ recurrence_mode: 'interval', interval_days: 2, due_date: '2026-05-10' })
    const info = classify(t, '2026-05-15') // 5 days late, a 2-day cycle
    expect(info.status).toBe('late')
    expect(info.daysLate).toBe(1)
    expect(info.notifiable).toBe(true)
  })

  it('wraps a weekly_days task to the most recent matching weekday', () => {
    // Due Monday 5/11, recurring Mon/Wed. Two weeks (four cycles) plus one
    // extra day later should read as one day late, not fourteen.
    const t = task({ recurrence_mode: 'weekly_days', interval_days: null, weekly_days: [1, 3], due_date: '2026-05-11' })
    const info = classify(t, '2026-05-25') // 14 days late
    expect(info.status).toBe('due')
    expect(info.daysLate).toBe(0)

    const infoPlusOne = classify(t, '2026-05-26') // 15 days late
    expect(infoPlusOne.status).toBe('late')
    expect(infoPlusOne.daysLate).toBe(1)
  })
})

describe('cycleLateness', () => {
  function cyclic(overrides: Partial<CyclicTask> = {}): CyclicTask {
    return {
      task_type: 'recurring',
      recurrence_mode: 'interval',
      interval_days: 7,
      weekly_days: null,
      ...overrides,
    }
  }

  it('leaves a non-recurring task unchanged', () => {
    expect(cycleLateness(cyclic({ task_type: 'one_time' }), '2026-05-10', 30)).toBe(30)
  })

  it('leaves a non-positive gap unchanged', () => {
    expect(cycleLateness(cyclic(), '2026-05-10', 0)).toBe(0)
  })

  it('wraps an interval task with the modulo of its own interval', () => {
    const t = cyclic({ interval_days: 4 })
    expect(cycleLateness(t, '2026-05-10', 3)).toBe(3) // under a cycle: unchanged
    expect(cycleLateness(t, '2026-05-10', 4)).toBe(0) // exactly one cycle: due
    expect(cycleLateness(t, '2026-05-10', 11)).toBe(3) // 2.75 cycles: 3 of the 4 days
  })

  it('falls through unchanged when a recurring task is missing the fields its mode needs', () => {
    expect(cycleLateness(cyclic({ interval_days: null }), '2026-05-10', 9)).toBe(9)
    expect(cycleLateness(cyclic({ recurrence_mode: 'weekly_days', weekly_days: [] }), '2026-05-10', 9)).toBe(9)
    expect(cycleLateness(cyclic({ recurrence_mode: null }), '2026-05-10', 9)).toBe(9)
  })

  it('walks weekly_days grid points to find the most recent one', () => {
    const t = cyclic({ recurrence_mode: 'weekly_days', interval_days: null, weekly_days: [1, 3] })
    // Due Monday 5/11: grid points (unevenly spaced) are Wed 5/13 (+2),
    // Mon 5/18 (+7), Wed 5/20 (+9), Mon 5/25 (+14), ...
    expect(cycleLateness(t, '2026-05-11', 2)).toBe(0) // exactly Wed 5/13: due
    expect(cycleLateness(t, '2026-05-11', 3)).toBe(1) // 1 day past Wed 5/13
    expect(cycleLateness(t, '2026-05-11', 7)).toBe(0) // exactly Mon 5/18: due
    expect(cycleLateness(t, '2026-05-11', 11)).toBe(2) // 2 days past Wed 5/20
  })
})

describe('classifying a time-limited task', () => {
  function windowTask(overrides: Partial<DueTask> = {}): DueTask {
    return task({
      task_type: 'time_limited',
      recurrence_mode: null,
      interval_days: null,
      starts_at: '2026-05-10T17:00:00.000Z',
      expires_at: '2026-05-10T20:00:00.000Z',
      ...overrides,
    })
  }

  it('is scheduled before the window opens', () => {
    const info = classify(windowTask(), '2026-05-10', new Date('2026-05-10T16:00:00.000Z'))
    expect(info.status).toBe('scheduled')
    expect(info.notifiable).toBe(false)
  })

  it('is active inside the window, and notifiable', () => {
    const info = classify(windowTask(), '2026-05-10', new Date('2026-05-10T18:00:00.000Z'))
    expect(info.status).toBe('active')
    expect(info.notifiable).toBe(true)
  })

  it('is expired once the window closes, even before the database row catches up', () => {
    const info = classify(windowTask(), '2026-05-10', new Date('2026-05-10T20:00:00.000Z'))
    expect(info.status).toBe('expired')
    expect(info.notifiable).toBe(false)
  })

  it('tells a completion, a cancellation and an expiry apart once is_done is true', () => {
    const completed = windowTask({ is_done: true, last_completed_date: '2026-05-10' })
    expect(classify(completed, '2026-05-10').status).toBe('completed_today')

    const completedEarlier = windowTask({ is_done: true, last_completed_date: '2026-05-09' })
    expect(classify(completedEarlier, '2026-05-10').status).toBe('done')

    const cancelled = windowTask({ is_done: true, cancelled_at: '2026-05-10T18:00:00.000Z' })
    expect(classify(cancelled, '2026-05-10').status).toBe('cancelled')

    const expired = windowTask({ is_done: true, expired_at: '2026-05-10T20:00:00.000Z' })
    expect(classify(expired, '2026-05-10').status).toBe('expired')
  })

  it('crosses midnight without treating the second day as a new window', () => {
    const spansDays = windowTask({
      starts_at: '2026-05-10T22:00:00.000Z',
      expires_at: '2026-05-14T10:00:00.000Z',
    })
    expect(classify(spansDays, '2026-05-12', new Date('2026-05-12T09:00:00.000Z')).status).toBe('active')
    expect(classify(spansDays, '2026-05-14', new Date('2026-05-14T11:00:00.000Z')).status).toBe('expired')
  })
})

describe('the same-day rule', () => {
  it('keeps a task visible and marked done on the day it was completed', () => {
    const completed = task({ due_date: '2026-05-17', last_completed_date: '2026-05-10' })
    const info = classify(completed, '2026-05-10')
    expect(info.status).toBe('completed_today')
    expect(info.notifiable).toBe(false)
    expect(actionable([completed], '2026-05-10')).toHaveLength(1)
  })

  it('drops it from the actionable list the next day', () => {
    const completed = task({ due_date: '2026-05-17', last_completed_date: '2026-05-10' })
    expect(classify(completed, '2026-05-11').status).toBe('upcoming')
    expect(actionable([completed], '2026-05-11')).toHaveLength(0)
  })

  it('never notifies twice about a task someone else already completed', () => {
    const completed = task({ due_date: '2026-05-17', last_completed_date: '2026-05-10' })
    expect(notifiable([completed], '2026-05-10')).toHaveLength(0)
  })
})

describe('a finished task (is_done)', () => {
  it('is excluded from the actionable list, even overdue', () => {
    const done = task({ due_date: '2020-01-01', is_done: true })
    expect(classify(done, '2026-05-10').status).toBe('done')
    expect(classify(done, '2026-05-10').notifiable).toBe(false)
    expect(actionable([done], '2026-05-10')).toHaveLength(0)
  })

  it('still shows as completed_today on the day it finished', () => {
    const done = task({ due_date: '2026-05-10', is_done: true, last_completed_date: '2026-05-10' })
    expect(classify(done, '2026-05-10').status).toBe('completed_today')
  })
})

describe('list ordering', () => {
  it('puts the most overdue first and finished/upcoming ones out entirely', () => {
    const today = '2026-05-10'
    const list = [
      task({ due_date: '2026-05-10' }), // due today
      task({ due_date: '2026-05-17', last_completed_date: today }), // done today
      task({ due_date: '2026-05-07' }), // 3 days late
      task({ due_date: '2026-05-09' }), // 1 day late
      task({ due_date: '2026-06-01' }), // upcoming, excluded
      task({ due_date: '2020-01-01', is_done: true }), // finished, excluded
    ]
    const ordered = actionable(list, today)
    expect(ordered.map((t) => t.due_date)).toEqual(['2026-05-07', '2026-05-09', '2026-05-10', '2026-05-17'])
  })
})

describe('timezone helpers', () => {
  it('reads the local date in a named timezone', () => {
    const instant = new Date('2026-06-01T22:30:00Z')
    expect(todayIn('Asia/Jerusalem', instant)).toBe('2026-06-02')
    expect(todayIn('UTC', instant)).toBe('2026-06-01')
  })

  it('reads minutes since local midnight', () => {
    const instant = new Date('2026-06-01T16:05:00Z')
    expect(minutesOfDayIn('UTC', instant)).toBe(16 * 60 + 5)
    expect(minutesOfDayIn('Asia/Jerusalem', instant)).toBe(19 * 60 + 5)
  })

  it('reports midnight as zero rather than 1440', () => {
    expect(minutesOfDayIn('UTC', new Date('2026-06-01T00:10:00Z'))).toBe(10)
  })

  it('formats an instant as HH:MM in a named timezone', () => {
    expect(formatTimeIn('UTC', '2026-06-01T16:05:00Z')).toBe('16:05')
    expect(formatTimeIn('Asia/Jerusalem', '2026-06-01T16:05:00Z')).toBe('19:05')
  })
})

describe('nextWeeklyDate', () => {
  // 2026-05-10 is a Sunday.
  it('finds the next matching weekday, wrapping into the following week', () => {
    expect(nextWeeklyDate([1, 3], '2026-05-10')).toBe('2026-05-11') // Monday
    expect(nextWeeklyDate([3], '2026-05-13')).toBe('2026-05-20') // next Wednesday
  })

  it('never returns the same day even if it matches', () => {
    // Sunday is day 0; completing on a Sunday should not schedule "today" again.
    expect(nextWeeklyDate([0], '2026-05-10')).toBe('2026-05-17')
  })
})

describe('planCompletion', () => {
  it('finishes a one-time task for good', () => {
    const t = task({ task_type: 'one_time', recurrence_mode: null, interval_days: null, due_date: '2026-05-10' })
    const outcome = planCompletion(t, '2026-05-10')
    expect(outcome).toEqual({ nextDueDate: null, occurrencesCompleted: 1, finished: true })
  })

  it('finishes a time-limited task for good, the same as a one-time task', () => {
    const t = task({ task_type: 'time_limited', recurrence_mode: null, interval_days: null, due_date: '2026-05-10' })
    const outcome = planCompletion(t, '2026-05-10')
    expect(outcome).toEqual({ nextDueDate: null, occurrencesCompleted: 1, finished: true })
  })

  it('schedules an interval task from the day it was actually completed', () => {
    // Due the 10th, actually completed the 13th: the next one is the 20th,
    // not the 17th, so a task you were late on does not stay behind forever.
    const t = task({ interval_days: 7, due_date: '2026-05-10' })
    expect(planCompletion(t, '2026-05-13')).toEqual({
      nextDueDate: '2026-05-20',
      occurrencesCompleted: 1,
      finished: false,
    })
  })

  it('schedules a weekly-days task onto the next matching weekday', () => {
    const t = task({ recurrence_mode: 'weekly_days', interval_days: null, weekly_days: [1, 3], due_date: '2026-05-11' })
    const outcome = planCompletion(t, '2026-05-11') // a Monday
    expect(outcome.nextDueDate).toBe('2026-05-13') // Wednesday
    expect(outcome.finished).toBe(false)
  })

  it('finishes a recurring task once it reaches its "after N times" limit', () => {
    const t = task({ end_condition: 'after_count', end_after_count: 3, occurrences_completed: 2 })
    const outcome = planCompletion(t, '2026-05-10')
    expect(outcome.occurrencesCompleted).toBe(3)
    expect(outcome.finished).toBe(true)
    expect(outcome.nextDueDate).toBeNull()
  })

  it('keeps recurring right up to the limit', () => {
    const t = task({ end_condition: 'after_count', end_after_count: 3, occurrences_completed: 1 })
    const outcome = planCompletion(t, '2026-05-10')
    expect(outcome.occurrencesCompleted).toBe(2)
    expect(outcome.finished).toBe(false)
  })

  it('finishes a recurring task once its next occurrence would fall after the end date', () => {
    const t = task({ end_condition: 'on_date', end_date: '2026-05-15', interval_days: 7, due_date: '2026-05-10' })
    const outcome = planCompletion(t, '2026-05-10')
    expect(outcome.finished).toBe(true) // next would be 2026-05-17, past the end date
    expect(outcome.nextDueDate).toBeNull()
  })

  it('keeps recurring while the next occurrence still lands on or before the end date', () => {
    const t = task({ end_condition: 'on_date', end_date: '2026-05-20', interval_days: 7, due_date: '2026-05-10' })
    const outcome = planCompletion(t, '2026-05-10')
    expect(outcome.finished).toBe(false)
    expect(outcome.nextDueDate).toBe('2026-05-17')
  })

  it('never finishes a task set to recur forever', () => {
    const t = task({ end_condition: 'never', occurrences_completed: 500 })
    expect(planCompletion(t, '2026-05-10').finished).toBe(false)
  })
})
