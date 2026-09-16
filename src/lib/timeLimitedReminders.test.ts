import { describe, expect, it } from 'vitest'
import { dueReminderSlots, type TimeLimitedTask } from '../../supabase/functions/_shared/timeLimitedReminders.ts'

const WINDOW = 60 // minutes, matching send-reminders' default WINDOW_MINUTES

function task(overrides: Partial<TimeLimitedTask> = {}): TimeLimitedTask {
  return {
    id: 'task-1',
    startsAt: '2026-09-16T17:00:00.000Z',
    expiresAt: '2026-09-16T20:00:00.000Z',
    reminderPolicy: { mode: 'interval', intervalMinutes: 30, finalReminderMinutesBeforeExpiry: null },
    ...overrides,
  }
}

describe('dueReminderSlots', () => {
  it('sends nothing before the window opens', () => {
    const now = new Date('2026-09-16T16:00:00.000Z')
    expect(dueReminderSlots(task(), now, WINDOW)).toEqual([])
  })

  it('sends nothing once the window has closed', () => {
    const now = new Date('2026-09-16T20:00:00.000Z')
    expect(dueReminderSlots(task(), now, WINDOW)).toEqual([])
  })

  it('sends nothing with no reminder policy, or an explicit "none"', () => {
    const now = new Date('2026-09-16T17:00:00.000Z')
    expect(dueReminderSlots(task({ reminderPolicy: null }), now, WINDOW)).toEqual([])
    expect(
      dueReminderSlots(
        task({ reminderPolicy: { mode: 'none', intervalMinutes: null, finalReminderMinutesBeforeExpiry: null } }),
        now,
        WINDOW,
      ),
    ).toEqual([])
  })

  it('fires once at the start for "start only", and never again later', () => {
    const policy = { mode: 'start_only' as const, intervalMinutes: null, finalReminderMinutesBeforeExpiry: null }
    const atStart = dueReminderSlots(task({ reminderPolicy: policy }), new Date('2026-09-16T17:00:00.000Z'), WINDOW)
    expect(atStart).toEqual([{ taskId: 'task-1', slot: '2026-09-16T17:00:00.000Z' }])

    const anHourLater = dueReminderSlots(
      task({ reminderPolicy: policy }),
      new Date('2026-09-16T18:00:00.000Z'),
      WINDOW,
    )
    expect(anHourLater).toEqual([])
  })

  it('fires on each interval boundary, identified by that boundary\'s own instant', () => {
    const t = task({ reminderPolicy: { mode: 'interval', intervalMinutes: 30, finalReminderMinutesBeforeExpiry: null } })

    expect(dueReminderSlots(t, new Date('2026-09-16T17:00:00.000Z'), WINDOW)).toEqual([
      { taskId: 'task-1', slot: '2026-09-16T17:00:00.000Z' },
    ])
    expect(dueReminderSlots(t, new Date('2026-09-16T17:30:00.000Z'), WINDOW)).toEqual([
      { taskId: 'task-1', slot: '2026-09-16T17:30:00.000Z' },
    ])
    // Between boundaries, the current slot is still the last one that
    // passed - the caller's own dedup log is what stops a second send here,
    // not this function pretending the slot has not happened yet.
    expect(dueReminderSlots(t, new Date('2026-09-16T17:45:00.000Z'), WINDOW)).toEqual([
      { taskId: 'task-1', slot: '2026-09-16T17:30:00.000Z' },
    ])
  })

  it('adds the final reminder before expiry on top of the regular cadence', () => {
    const t = task({
      reminderPolicy: { mode: 'interval', intervalMinutes: 30, finalReminderMinutesBeforeExpiry: 15 },
    })
    // 19:45 is both an interval boundary (17:00 + 5.5h is not, but 19:45 is
    // not a multiple of 30 from 17:00 either - pick a moment that is only the
    // final-reminder slot to prove it fires independently of the cadence).
    const slots = dueReminderSlots(t, new Date('2026-09-16T19:45:00.000Z'), WINDOW)
    expect(slots).toEqual(
      expect.arrayContaining([{ taskId: 'task-1', slot: '2026-09-16T19:45:00.000Z' }]),
    )
  })

  it('never returns the same slot twice, even if the cadence and the final reminder coincide', () => {
    const t = task({
      startsAt: '2026-09-16T19:30:00.000Z',
      expiresAt: '2026-09-16T20:00:00.000Z',
      reminderPolicy: { mode: 'interval', intervalMinutes: 30, finalReminderMinutesBeforeExpiry: 30 },
    })
    const slots = dueReminderSlots(t, new Date('2026-09-16T19:30:00.000Z'), WINDOW)
    expect(slots).toEqual([{ taskId: 'task-1', slot: '2026-09-16T19:30:00.000Z' }])
  })
})
