import { describe, expect, it } from 'vitest'
import { errorMessage } from './errors'

describe('errorMessage', () => {
  it('reads the message off a real Error', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom')
  })

  it('reads the message off a Supabase-shaped error object', () => {
    expect(errorMessage({ message: 'row not found', code: 'PGRST116' })).toBe('row not found')
  })

  it('falls back to String() for anything else', () => {
    expect(errorMessage('a plain string')).toBe('a plain string')
    expect(errorMessage(42)).toBe('42')
    expect(errorMessage(null)).toBe('null')
  })
})
