import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { describeWeeklyDays, formatDateTime, formatSnoozeUntil, personLabel, weekdayShort } from './format'

describe('personLabel', () => {
  const people = new Map([
    ['dana-id', { display_name: 'Dana Cohen', email: 'dana@example.com' }],
    ['no-name-id', { display_name: null, email: null }],
  ])

  it('is "you" for the signed-in person themselves', () => {
    expect(personLabel('self-id', people, 'self-id', 'he')).toEqual({ kind: 'you' })
  })

  it('gives the first name of someone found in the people map', () => {
    expect(personLabel('dana-id', people, 'self-id', 'he')).toEqual({ kind: 'other', name: 'Dana' })
  })

  it('gives a null name for someone not in the people map - "someone else" is worded by the caller', () => {
    expect(personLabel('a-stranger', people, 'self-id', 'he')).toEqual({ kind: 'other', name: null })
  })

  it('falls back to a null-name label for a person with no display name or email', () => {
    expect(personLabel('no-name-id', people, 'self-id', 'en')).toEqual({ kind: 'other', name: 'someone' })
  })

  it('is null when there is no user id at all', () => {
    expect(personLabel(null, people, 'self-id', 'he')).toBeNull()
  })
})

// formatSnoozeUntil is deliberately dependent on this device's own timezone -
// that is the whole point, showing when the reminder comes back in the
// viewer's own local time - so these tests pin the process timezone to a
// known zone rather than whatever happens to run the suite.
describe('formatSnoozeUntil', () => {
  const originalTz = process.env.TZ

  beforeEach(() => {
    process.env.TZ = 'Asia/Jerusalem'
  })

  afterEach(() => {
    process.env.TZ = originalTz
  })

  it('shows just the time when the snooze ends later the same local day', () => {
    // 20:30 in Asia/Jerusalem (UTC+2 in January) is 18:30 UTC.
    expect(formatSnoozeUntil('2026-01-10T18:30:00.000Z', '2026-01-10', 'he')).toBe('20:30')
  })

  it('names the day when the snooze crosses local midnight into tomorrow', () => {
    // 00:30 local on the 11th is 22:30 UTC on the 10th.
    expect(formatSnoozeUntil('2026-01-10T22:30:00.000Z', '2026-01-10', 'he')).toBe('מחר 00:30')
    expect(formatSnoozeUntil('2026-01-10T22:30:00.000Z', '2026-01-10', 'en')).toBe('tomorrow 00:30')
  })

  it('names a later day when the snooze is more than a day out', () => {
    expect(formatSnoozeUntil('2026-01-12T18:30:00.000Z', '2026-01-10', 'he')).toBe('מחרתיים 20:30')
  })
})

// Like formatSnoozeUntil, deliberately dependent on this device's own
// timezone - a completion history is about when *you* did it.
describe('formatDateTime', () => {
  const originalTz = process.env.TZ

  beforeEach(() => {
    process.env.TZ = 'Asia/Jerusalem'
  })

  afterEach(() => {
    process.env.TZ = originalTz
  })

  it('renders the exact date and time of a completion, in this device\'s timezone', () => {
    // 20:30 in Asia/Jerusalem (UTC+2 in January) is 18:30 UTC.
    expect(formatDateTime('2026-01-10T18:30:00.000Z', 'he')).toBe('שבת, 10 בינו׳ · 20:30')
    expect(formatDateTime('2026-01-10T18:30:00.000Z', 'en')).toBe('Sat 10 Jan · 20:30')
  })
})

describe('weekdayShort', () => {
  it('gives a short label for every day of the week, in both languages', () => {
    expect(weekdayShort(0, 'en')).toBe('Sun')
    expect(weekdayShort(6, 'en')).toBe('Sat')
    expect(weekdayShort(1, 'he')).toBe('ב׳')
  })
})

describe('describeWeeklyDays', () => {
  it('lists the chosen days in week order regardless of input order', () => {
    expect(describeWeeklyDays([3, 1], 'en')).toBe('Monday, Wednesday')
    expect(describeWeeklyDays([5, 0], 'he')).toBe('ראשון, שישי')
  })
})
