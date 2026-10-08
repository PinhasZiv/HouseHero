import { describe, expect, it } from 'vitest'
import { toDatetimeLocalValue } from './format'
import { SNOOZE_PRESETS, fixedTimeSnoozes, isValidSnoozeInstant, snoozeUntilInMinutes } from './snoozeOptions'

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

describe('fixedTimeSnoozes', () => {
  it('offers this evening and tomorrow morning during the day', () => {
    const now = new Date(2026, 0, 10, 14, 0)
    const options = fixedTimeSnoozes(now)
    expect(options.map((o) => o.labelKey)).toEqual(['tonight', 'morning'])
    expect(new Date(options[0].until)).toEqual(new Date(2026, 0, 10, 20, 0))
    expect(new Date(options[1].until)).toEqual(new Date(2026, 0, 11, 8, 0))
  })

  it('drops "this evening" once it is less than half an hour away, or past', () => {
    expect(fixedTimeSnoozes(new Date(2026, 0, 10, 19, 31)).map((o) => o.labelKey)).toEqual(['morning'])
    expect(fixedTimeSnoozes(new Date(2026, 0, 10, 22, 0)).map((o) => o.labelKey)).toEqual(['morning'])
  })

  it('"morning" after midnight means the coming 08:00, the same calendar day', () => {
    const options = fixedTimeSnoozes(new Date(2026, 0, 10, 0, 30))
    expect(new Date(options[options.length - 1].until)).toEqual(new Date(2026, 0, 10, 8, 0))
  })

  it('"morning" within half an hour of 08:00 rolls over to the next day', () => {
    const options = fixedTimeSnoozes(new Date(2026, 0, 10, 7, 45))
    expect(new Date(options[options.length - 1].until)).toEqual(new Date(2026, 0, 11, 8, 0))
  })

  it('crosses a month boundary', () => {
    const options = fixedTimeSnoozes(new Date(2026, 0, 31, 21, 0))
    expect(new Date(options[0].until)).toEqual(new Date(2026, 1, 1, 8, 0))
  })
})
