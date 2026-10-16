import { describe, expect, it } from 'vitest'
import { brokenDays, houseStreak, type StreakTask } from './streak'

const TODAY = '2026-10-17'

function daily(id: string, overrides: Partial<StreakTask> = {}): StreakTask {
  return { id, task_type: 'recurring', recurrence_mode: 'interval', interval_days: 1, weekly_days: null, due_date: TODAY, is_done: false, ...overrides }
}

function weekly(id: string, overrides: Partial<StreakTask> = {}): StreakTask {
  return daily(id, { interval_days: 7, ...overrides })
}

describe('brokenDays', () => {
  it('a completion on its due date breaks nothing', () => {
    expect(brokenDays([daily('t')], [{ task_id: 't', on: '2026-10-15', prev_due_date: '2026-10-15' }], TODAY).size).toBe(0)
  })

  it('a daily task done two days late broke the two days it was left', () => {
    const broken = brokenDays([daily('t')], [{ task_id: 't', on: '2026-10-16', prev_due_date: '2026-10-14' }], TODAY)
    expect([...broken].sort()).toEqual(['2026-10-14', '2026-10-15'])
  })

  it('a weekly task done a day into a later cycle broke the missed occurrence and the late one', () => {
    // Due 1 Oct, done 9 Oct: 1 Oct went by entirely, and the 8 Oct
    // occurrence was a day late.
    const broken = brokenDays([weekly('t')], [{ task_id: 't', on: '2026-10-09', prev_due_date: '2026-10-01' }], TODAY)
    expect([...broken].sort()).toEqual(['2026-10-01', '2026-10-08'])
  })

  it('a skip settles a day the same as a completion - unless it came late', () => {
    expect(brokenDays([daily('t')], [{ task_id: 't', on: '2026-10-15', prev_due_date: '2026-10-15' }], TODAY).size).toBe(0)
    expect([...brokenDays([daily('t')], [{ task_id: 't', on: '2026-10-16', prev_due_date: '2026-10-15' }], TODAY)]).toEqual(['2026-10-15'])
  })

  it('a one-time task done late breaks only its due day', () => {
    const task = daily('t', { task_type: 'one_time', interval_days: null, recurrence_mode: null, is_done: true })
    expect([...brokenDays([task], [{ task_id: 't', on: '2026-10-16', prev_due_date: '2026-10-12' }], TODAY)]).toEqual(['2026-10-12'])
  })

  it('an open task already past its due date breaks the days it has gone past, not today', () => {
    const broken = brokenDays([daily('t', { due_date: '2026-10-15' })], [], TODAY)
    expect([...broken].sort()).toEqual(['2026-10-15', '2026-10-16'])
    expect(brokenDays([daily('t', { due_date: TODAY })], [], TODAY).size).toBe(0)
  })

  it('a task frozen for a vacation, or a time-limited one, breaks nothing', () => {
    const paused = daily('p', { due_date: '2026-10-10' })
    expect(brokenDays([paused], [], TODAY, () => true).size).toBe(0)
    const windowTask = daily('w', { task_type: 'time_limited', due_date: '2026-10-10' })
    expect(brokenDays([windowTask], [{ task_id: 'w', on: '2026-10-16', prev_due_date: '2026-10-10' }], TODAY).size).toBe(0)
  })

  it('ignores rows for tasks that no longer exist', () => {
    expect(brokenDays([], [{ task_id: 'gone', on: '2026-10-16', prev_due_date: '2026-10-10' }], TODAY).size).toBe(0)
  })
})

describe('houseStreak', () => {
  it('counts back from yesterday to the first day there was anything to do', () => {
    expect(houseStreak({ tasks: [daily('t')], handled: [], today: TODAY, since: '2026-10-07', todayClosed: false })).toBe(10)
  })

  it('stops at the most recent day something was left undone', () => {
    const handled = [{ task_id: 't', on: '2026-10-13', prev_due_date: '2026-10-12' }]
    // 12 Oct broke; 13-16 Oct are clean.
    expect(houseStreak({ tasks: [daily('t')], handled, today: TODAY, since: '2026-10-01', todayClosed: false })).toBe(4)
  })

  it('adds today once today is cleared, and never lets today break it', () => {
    const base = { tasks: [daily('t')], handled: [], today: TODAY, since: '2026-10-14' }
    expect(houseStreak({ ...base, todayClosed: false })).toBe(3)
    expect(houseStreak({ ...base, todayClosed: true })).toBe(4)
  })

  it('is zero when yesterday was missed and today is still open', () => {
    expect(houseStreak({ tasks: [daily('t', { due_date: '2026-10-16' })], handled: [], today: TODAY, since: '2026-10-01', todayClosed: false })).toBe(0)
  })

  it('does not count further back than it is told to', () => {
    expect(houseStreak({ tasks: [daily('t')], handled: [], today: TODAY, since: '2025-01-01', todayClosed: false, maxDays: 30 })).toBe(30)
  })
})
