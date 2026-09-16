import { describe, expect, it } from 'vitest'
import { dueReminderSlots, type TimeLimitedTask } from '../../supabase/functions/_shared/timeLimitedReminders.ts'

const WINDOW = 60 // minutes, matching send-reminders' default WINDOW_MINUTES
const TZ = 'UTC' // only 'daily' mode reads this; the other modes are timezone-agnostic

function task(overrides: Partial<TimeLimitedTask> = {}): TimeLimitedTask {
  return {
    id: 'task-1',
    startsAt: '2026-09-16T17:00:00.000Z',
    expiresAt: '2026-09-16T20:00:00.000Z',
    reminderPolicy: {
      mode: 'interval',
      intervalMinutes: 30,
      dailyIntervalDays: null,
      dailyHour: null,
      dailyMinute: null,
      finalReminderMinutesBeforeExpiry: null,
    },
    ...overrides,
  }
}

describe('dueReminderSlots', () => {
  it('sends nothing before the window opens', () => {
    const now = new Date('2026-09-16T16:00:00.000Z')
    expect(dueReminderSlots(task(), now, WINDOW, TZ)).toEqual([])
  })

  it('sends nothing once the window has closed', () => {
    const now = new Date('2026-09-16T20:00:00.000Z')
    expect(dueReminderSlots(task(), now, WINDOW, TZ)).toEqual([])
  })

  it('sends nothing with no reminder policy, or an explicit "none"', () => {
    const now = new Date('2026-09-16T17:00:00.000Z')
    expect(dueReminderSlots(task({ reminderPolicy: null }), now, WINDOW, TZ)).toEqual([])
    expect(
      dueReminderSlots(
        task({
          reminderPolicy: {
            mode: 'none',
            intervalMinutes: null,
            dailyIntervalDays: null,
            dailyHour: null,
            dailyMinute: null,
            finalReminderMinutesBeforeExpiry: null,
          },
        }),
        now,
        WINDOW,
        TZ,
      ),
    ).toEqual([])
  })

  it('fires once at the start for "start only", and never again later', () => {
    const policy = {
      mode: 'start_only' as const,
      intervalMinutes: null,
      dailyIntervalDays: null,
      dailyHour: null,
      dailyMinute: null,
      finalReminderMinutesBeforeExpiry: null,
    }
    const atStart = dueReminderSlots(
      task({ reminderPolicy: policy }),
      new Date('2026-09-16T17:00:00.000Z'),
      WINDOW,
      TZ,
    )
    expect(atStart).toEqual([{ taskId: 'task-1', slot: '2026-09-16T17:00:00.000Z' }])

    const anHourLater = dueReminderSlots(
      task({ reminderPolicy: policy }),
      new Date('2026-09-16T18:00:00.000Z'),
      WINDOW,
      TZ,
    )
    expect(anHourLater).toEqual([])
  })

  it('fires on each interval boundary, identified by that boundary\'s own instant', () => {
    const t = task({
      reminderPolicy: {
        mode: 'interval',
        intervalMinutes: 30,
        dailyIntervalDays: null,
        dailyHour: null,
        dailyMinute: null,
        finalReminderMinutesBeforeExpiry: null,
      },
    })

    expect(dueReminderSlots(t, new Date('2026-09-16T17:00:00.000Z'), WINDOW, TZ)).toEqual([
      { taskId: 'task-1', slot: '2026-09-16T17:00:00.000Z' },
    ])
    expect(dueReminderSlots(t, new Date('2026-09-16T17:30:00.000Z'), WINDOW, TZ)).toEqual([
      { taskId: 'task-1', slot: '2026-09-16T17:30:00.000Z' },
    ])
    // Between boundaries, the current slot is still the last one that
    // passed - the caller's own dedup log is what stops a second send here,
    // not this function pretending the slot has not happened yet.
    expect(dueReminderSlots(t, new Date('2026-09-16T17:45:00.000Z'), WINDOW, TZ)).toEqual([
      { taskId: 'task-1', slot: '2026-09-16T17:30:00.000Z' },
    ])
  })

  it('an hours-based cadence is just intervalMinutes pre-multiplied by 60 - no special-casing needed', () => {
    const t = task({
      reminderPolicy: {
        mode: 'interval',
        intervalMinutes: 3 * 60, // "every 3 hours", as the form would store it
        dailyIntervalDays: null,
        dailyHour: null,
        dailyMinute: null,
        finalReminderMinutesBeforeExpiry: null,
      },
      startsAt: '2026-09-16T14:10:00.000Z',
      expiresAt: '2026-09-17T14:10:00.000Z',
    })

    expect(dueReminderSlots(t, new Date('2026-09-16T14:10:00.000Z'), WINDOW, TZ)).toEqual([
      { taskId: 'task-1', slot: '2026-09-16T14:10:00.000Z' },
    ])
    expect(dueReminderSlots(t, new Date('2026-09-16T17:10:00.000Z'), WINDOW, TZ)).toEqual([
      { taskId: 'task-1', slot: '2026-09-16T17:10:00.000Z' },
    ])
  })

  it('adds the final reminder before expiry on top of the regular cadence', () => {
    const t = task({
      reminderPolicy: {
        mode: 'interval',
        intervalMinutes: 30,
        dailyIntervalDays: null,
        dailyHour: null,
        dailyMinute: null,
        finalReminderMinutesBeforeExpiry: 15,
      },
    })
    // 19:45 is both an interval boundary (17:00 + 5.5h is not, but 19:45 is
    // not a multiple of 30 from 17:00 either - pick a moment that is only the
    // final-reminder slot to prove it fires independently of the cadence).
    const slots = dueReminderSlots(t, new Date('2026-09-16T19:45:00.000Z'), WINDOW, TZ)
    expect(slots).toEqual(
      expect.arrayContaining([{ taskId: 'task-1', slot: '2026-09-16T19:45:00.000Z' }]),
    )
  })

  it('never returns the same slot twice, even if the cadence and the final reminder coincide', () => {
    const t = task({
      startsAt: '2026-09-16T19:30:00.000Z',
      expiresAt: '2026-09-16T20:00:00.000Z',
      reminderPolicy: {
        mode: 'interval',
        intervalMinutes: 30,
        dailyIntervalDays: null,
        dailyHour: null,
        dailyMinute: null,
        finalReminderMinutesBeforeExpiry: 30,
      },
    })
    const slots = dueReminderSlots(t, new Date('2026-09-16T19:30:00.000Z'), WINDOW, TZ)
    expect(slots).toEqual([{ taskId: 'task-1', slot: '2026-09-16T19:30:00.000Z' }])
  })

  describe('mode: "daily"', () => {
    function dailyTask(overrides: Partial<TimeLimitedTask> = {}): TimeLimitedTask {
      return task({
        startsAt: '2026-09-16T10:00:00.000Z',
        expiresAt: '2026-09-20T10:00:00.000Z',
        reminderPolicy: {
          mode: 'daily',
          intervalMinutes: null,
          dailyIntervalDays: 1,
          dailyHour: 18,
          dailyMinute: 0,
          finalReminderMinutesBeforeExpiry: null,
        },
        ...overrides,
      })
    }

    it('fires today at the chosen time when the window opened earlier the same day', () => {
      const t = dailyTask()
      expect(dueReminderSlots(t, new Date('2026-09-16T18:00:00.000Z'), WINDOW, TZ)).toEqual([
        { taskId: 'task-1', slot: '2026-09-16T18:00:00.000Z' },
      ])
    })

    it('waits for the next reminder day when the chosen time already passed on the opening day', () => {
      // Window opens 10:00, daily reminder set to 08:00 - already gone by the
      // time the window itself opens, so day one never fires.
      const t = dailyTask({ startsAt: '2026-09-16T10:00:00.000Z' })
      const withEarlyTime = { ...t, reminderPolicy: { ...t.reminderPolicy!, dailyHour: 8 } }

      expect(dueReminderSlots(withEarlyTime, new Date('2026-09-16T10:05:00.000Z'), WINDOW, TZ)).toEqual([])
      expect(dueReminderSlots(withEarlyTime, new Date('2026-09-17T08:05:00.000Z'), WINDOW, TZ)).toEqual([
        { taskId: 'task-1', slot: '2026-09-17T08:00:00.000Z' },
      ])
    })

    it('only fires on a multiple of dailyIntervalDays', () => {
      const t = dailyTask({ reminderPolicy: { ...dailyTask().reminderPolicy!, dailyIntervalDays: 2 } })
      // Day 1 since start (16th -> 17th) is not a multiple of 2 - skipped.
      expect(dueReminderSlots(t, new Date('2026-09-17T18:00:00.000Z'), WINDOW, TZ)).toEqual([])
      // Day 2 since start (16th -> 18th) is - fires.
      expect(dueReminderSlots(t, new Date('2026-09-18T18:00:00.000Z'), WINDOW, TZ)).toEqual([
        { taskId: 'task-1', slot: '2026-09-18T18:00:00.000Z' },
      ])
    })

    it('respects the recipient\'s own timezone, not UTC', () => {
      // Window already open well before the moment under test.
      const t = dailyTask({
        startsAt: '2026-09-15T20:00:00.000Z',
        reminderPolicy: { ...dailyTask().reminderPolicy!, dailyHour: 9, dailyMinute: 0 },
      })
      // 09:00 in Asia/Jerusalem (UTC+3 in September) is 06:00 UTC.
      expect(dueReminderSlots(t, new Date('2026-09-16T06:00:00.000Z'), WINDOW, 'Asia/Jerusalem')).toEqual([
        { taskId: 'task-1', slot: '2026-09-16T09:00:00.000Z' },
      ])
      expect(dueReminderSlots(t, new Date('2026-09-16T06:00:00.000Z'), WINDOW, 'UTC')).toEqual([])
    })
  })
})
