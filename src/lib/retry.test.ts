import { describe, expect, it, vi } from 'vitest'
import { withRetry } from './retry'

describe('withRetry', () => {
  it('returns the result on the first try when it succeeds', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    await expect(withRetry(fn, [1, 1])).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries after a failure and returns the result of a later success', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('ok')
    await expect(withRetry(fn, [1, 1])).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('uses every delay before giving up, then throws the last error', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('boom'))
    await expect(withRetry(fn, [1, 1])).rejects.toThrow('boom')
    expect(fn).toHaveBeenCalledTimes(3) // the initial try plus both retries
  })

  it('never retries when given no delays', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('boom'))
    await expect(withRetry(fn, [])).rejects.toThrow('boom')
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
