import { describe, expect, it } from 'vitest'
import { googleCalendarUrl } from './googleCalendar'
import type { Task } from './types'

function baseTask(overrides: Partial<Task>): Task {
  return {
    id: 'task-1',
    space_id: 'space-1',
    title: 'לשטוף כלים',
    description: null,
    task_type: 'one_time',
    recurrence_mode: null,
    interval_days: null,
    weekly_days: null,
    end_condition: 'never',
    end_after_count: null,
    end_date: null,
    occurrences_completed: 0,
    points: 10,
    reminder_hour: 18,
    reminder_minute: 30,
    due_date: '2026-09-20',
    last_completed_date: null,
    last_completed_at: null,
    last_completed_by: null,
    last_completed_actor: null,
    is_done: false,
    assigned_to: null,
    created_by: 'user-1',
    created_at: '2026-01-01T00:00:00.000Z',
    starts_at: null,
    expires_at: null,
    reminder_policy: null,
    cancelled_at: null,
    expired_at: null,
    ...overrides,
  }
}

describe('googleCalendarUrl', () => {
  it('encodes the title and the due date/time as the event start', () => {
    const url = new URL(googleCalendarUrl(baseTask({})))
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render')
    expect(url.searchParams.get('action')).toBe('TEMPLATE')
    expect(url.searchParams.get('text')).toBe('לשטוף כלים')
    expect(url.searchParams.get('dates')).toBe('20260920T183000/20260920T190000')
  })

  it('carries the description as event details, and omits it when there is none', () => {
    const withDescription = new URL(googleCalendarUrl(baseTask({ description: 'רק את הכלים הגדולים' })))
    expect(withDescription.searchParams.get('details')).toBe('רק את הכלים הגדולים')

    const withoutDescription = new URL(googleCalendarUrl(baseTask({ description: null })))
    expect(withoutDescription.searchParams.has('details')).toBe(false)
  })

  it('adds no recurrence for a one-time task', () => {
    const url = new URL(googleCalendarUrl(baseTask({ task_type: 'one_time' })))
    expect(url.searchParams.has('recur')).toBe(false)
  })

  it('builds a daily-interval rule for an "every N days" task', () => {
    const url = new URL(
      googleCalendarUrl(
        baseTask({ task_type: 'recurring', recurrence_mode: 'interval', interval_days: 3 }),
      ),
    )
    expect(url.searchParams.get('recur')).toBe('RRULE:FREQ=DAILY;INTERVAL=3')
  })

  it('builds a weekly-by-day rule, mapping 0=Sunday through 6=Saturday to iCal day codes', () => {
    const url = new URL(
      googleCalendarUrl(
        baseTask({ task_type: 'recurring', recurrence_mode: 'weekly_days', weekly_days: [0, 3] }),
      ),
    )
    expect(url.searchParams.get('recur')).toBe('RRULE:FREQ=WEEKLY;BYDAY=SU,WE')
  })

  it('caps a "stop after N times" rule at the occurrences still remaining, not the lifetime total', () => {
    const url = new URL(
      googleCalendarUrl(
        baseTask({
          task_type: 'recurring',
          recurrence_mode: 'interval',
          interval_days: 1,
          end_condition: 'after_count',
          end_after_count: 10,
          occurrences_completed: 4,
        }),
      ),
    )
    expect(url.searchParams.get('recur')).toBe('RRULE:FREQ=DAILY;INTERVAL=1;COUNT=6')
  })

  it('uses the actual window, not a 30-minute placeholder, for a time-limited task', () => {
    const url = new URL(
      googleCalendarUrl(
        baseTask({
          task_type: 'time_limited',
          starts_at: '2026-09-16T17:00:00.000Z',
          expires_at: '2026-09-16T20:00:00.000Z',
        }),
      ),
    )
    expect(url.searchParams.get('dates')).toBe('20260916T170000/20260916T200000')
    expect(url.searchParams.has('recur')).toBe(false)
  })

  it('turns a "stop on date" rule into an UNTIL clause', () => {
    const url = new URL(
      googleCalendarUrl(
        baseTask({
          task_type: 'recurring',
          recurrence_mode: 'interval',
          interval_days: 7,
          end_condition: 'on_date',
          end_date: '2026-12-31',
        }),
      ),
    )
    expect(url.searchParams.get('recur')).toBe('RRULE:FREQ=DAILY;INTERVAL=7;UNTIL=20261231T235959Z')
  })
})
