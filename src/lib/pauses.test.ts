import { describe, expect, it } from 'vitest'
import { activityFloor, isTaskPaused, isUserPaused, personalPause, spacePause, type Pause } from './pauses'
import { classify, withPause, type DueTask } from './taskDue'

const HOME = 'space-home'
const CABIN = 'space-cabin'

function pause(overrides: Partial<Pause>): Pause {
  return { id: 'p', space_id: HOME, user_id: null, started_on: '2026-08-01', ended_on: null, ...overrides }
}

describe('who and what is paused', () => {
  it('a whole-space pause freezes every task in that space and silences everyone in it', () => {
    const pauses = [pause({ user_id: null })]
    expect(isTaskPaused(pauses, { space_id: HOME, assigned_to: null })).toBe(true)
    expect(isTaskPaused(pauses, { space_id: HOME, assigned_to: 'dana' })).toBe(true)
    expect(isUserPaused(pauses, HOME, 'dana')).toBe(true)
    expect(spacePause(pauses, HOME)).not.toBeNull()
  })

  it('a personal pause freezes only that person\'s own tasks; shared ones carry on', () => {
    const pauses = [pause({ user_id: 'dana' })]
    expect(isTaskPaused(pauses, { space_id: HOME, assigned_to: 'dana' })).toBe(true)
    expect(isTaskPaused(pauses, { space_id: HOME, assigned_to: 'yossi' })).toBe(false)
    expect(isTaskPaused(pauses, { space_id: HOME, assigned_to: null })).toBe(false)
    expect(isUserPaused(pauses, HOME, 'dana')).toBe(true)
    expect(isUserPaused(pauses, HOME, 'yossi')).toBe(false)
  })

  it('a personal pause applies to its own space only', () => {
    const pauses = [pause({ user_id: 'dana', space_id: HOME })]
    expect(isTaskPaused(pauses, { space_id: CABIN, assigned_to: 'dana' })).toBe(false)
    expect(isUserPaused(pauses, CABIN, 'dana')).toBe(false)
    expect(personalPause(pauses, CABIN, 'dana')).toBeNull()
  })

  it('an ended pause freezes nothing', () => {
    const pauses = [pause({ ended_on: '2026-08-10' }), pause({ id: 'q', user_id: 'dana', ended_on: '2026-08-10' })]
    expect(isTaskPaused(pauses, { space_id: HOME, assigned_to: 'dana' })).toBe(false)
    expect(isUserPaused(pauses, HOME, 'dana')).toBe(false)
  })
})

describe('activityFloor', () => {
  it('is the latest return day of a pause that covered the person', () => {
    const pauses = [
      pause({ id: 'a', ended_on: '2026-08-10' }),
      pause({ id: 'b', user_id: 'dana', ended_on: '2026-09-02' }),
      pause({ id: 'c', user_id: 'yossi', ended_on: '2026-09-20' }),
      pause({ id: 'd', space_id: CABIN, ended_on: '2026-09-25' }),
    ]
    expect(activityFloor(pauses, HOME, 'dana')).toBe('2026-09-02')
    expect(activityFloor(pauses, HOME, 'avi')).toBe('2026-08-10')
  })

  it('ignores a pause still on', () => {
    expect(activityFloor([pause({ user_id: 'dana' })], HOME, 'dana')).toBeNull()
  })
})

describe('withPause', () => {
  const base: DueTask = {
    task_type: 'recurring', recurrence_mode: 'interval', interval_days: 1, weekly_days: null,
    end_condition: 'never', end_after_count: null, end_date: null, occurrences_completed: 0,
    due_date: '2026-08-01', last_completed_date: null, last_skipped_date: null, is_done: false,
    starts_at: null, expires_at: null, cancelled_at: null, expired_at: null,
  }

  it('turns late into paused - no lateness, no notification', () => {
    const info = withPause(classify({ ...base, due_date: '2026-07-20' }, '2026-08-01'), true)
    expect(info).toEqual({ status: 'paused', daysLate: 0, notifiable: false })
  })

  it('turns due today into paused', () => {
    expect(withPause(classify(base, '2026-08-01'), true).status).toBe('paused')
  })

  it('leaves settled and future states alone', () => {
    expect(withPause(classify({ ...base, last_completed_date: '2026-08-01', due_date: '2026-08-02' }, '2026-08-01'), true).status)
      .toBe('completed_today')
    expect(withPause(classify({ ...base, due_date: '2026-08-05' }, '2026-08-01'), true).status).toBe('upcoming')
  })

  it('does nothing when the task is not paused', () => {
    const info = classify({ ...base, due_date: '2026-07-31' }, '2026-08-01')
    expect(withPause(info, false)).toBe(info)
  })
})
