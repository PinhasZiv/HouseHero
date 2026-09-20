import { describe, expect, it } from 'vitest'
import { toDatetimeLocalValue } from './format'
import { isValidCompletionInstant } from './completionOptions'

describe('isValidCompletionInstant', () => {
  const now = new Date(2026, 0, 10, 18, 0)

  it('accepts a past local time', () => {
    expect(isValidCompletionInstant('2026-01-10T16:00', now)).toBe(true)
  })

  it('accepts the exact current instant', () => {
    expect(isValidCompletionInstant(toDatetimeLocalValue(now), now)).toBe(true)
  })

  it('rejects a future local time - you cannot log something you have not done yet', () => {
    expect(isValidCompletionInstant('2026-01-10T20:00', now)).toBe(false)
  })

  it('rejects unparsable input', () => {
    expect(isValidCompletionInstant('', now)).toBe(false)
    expect(isValidCompletionInstant('not a date', now)).toBe(false)
  })
})
