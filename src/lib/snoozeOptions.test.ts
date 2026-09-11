import { describe, expect, it } from 'vitest'
import { SNOOZE_PRESETS, isValidSnoozeInstant, snoozeUntilInMinutes, toDatetimeLocalValue } from './snoozeOptions'

describe('snoozeUntilInMinutes', () => {
  it('adds the given number of minutes to now', () => {
    const now = new Date('2026-01-10T18:00:00.000Z')
    expect(snoozeUntilInMinutes(30, now)).toBe('2026-01-10T18:30:00.000Z')
    expect(snoozeUntilInMinutes(60, now)).toBe('2026-01-10T19:00:00.000Z')
    expect(snoozeUntilInMinutes(180, now)).toBe('2026-01-10T21:00:00.000Z')
  })

  it('crosses a day boundary correctly', () => {
    const now = new Date('2026-01-10T23:30:00.000Z')
    expect(snoozeUntilInMinutes(60, now)).toBe('2026-01-11T00:30:00.000Z')
  })
})

describe('toDatetimeLocalValue', () => {
  it('zero-pads every field to the shape a datetime-local input expects', () => {
    const date = new Date(2026, 0, 3, 9, 5) // 3 Jan 2026, 09:05 local
    expect(toDatetimeLocalValue(date)).toBe('2026-01-03T09:05')
  })

  it('round-trips through the Date constructor unchanged', () => {
    const date = new Date(2026, 8, 21, 23, 59)
    const value = toDatetimeLocalValue(date)
    const parsed = new Date(value)
    expect(parsed.getFullYear()).toBe(2026)
    expect(parsed.getMonth()).toBe(8)
    expect(parsed.getDate()).toBe(21)
    expect(parsed.getHours()).toBe(23)
    expect(parsed.getMinutes()).toBe(59)
  })
})

describe('isValidSnoozeInstant', () => {
  const now = new Date(2026, 0, 10, 18, 0)

  it('accepts a future local time', () => {
    expect(isValidSnoozeInstant('2026-01-10T20:00', now)).toBe(true)
  })

  it('rejects a past local time', () => {
    expect(isValidSnoozeInstant('2026-01-10T16:00', now)).toBe(false)
  })

  it('rejects the exact current instant - snoozing to "now" is not snoozing', () => {
    expect(isValidSnoozeInstant(toDatetimeLocalValue(now), now)).toBe(false)
  })

  it('rejects unparsable input', () => {
    expect(isValidSnoozeInstant('', now)).toBe(false)
    expect(isValidSnoozeInstant('not a date', now)).toBe(false)
  })
})

describe('SNOOZE_PRESETS', () => {
  it('is exactly the three durations the picker offers, in order', () => {
    expect(SNOOZE_PRESETS.map((preset) => preset.minutes)).toEqual([30, 60, 180])
  })
})
