import { describe, expect, it, vi } from 'vitest'
import { COLD_START_RETRY_DELAYS_MS, withRetry } from './retry'

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

describe('COLD_START_RETRY_DELAYS_MS', () => {
  it('gives a cold-start fetch several increasingly spaced attempts, not just one', () => {
    // Regression guard: this schedule was widened once already (a single
    // 1.2s retry cleared a fast cold-start race but still lost to a slower
    // reconnect), so a future change shrinking it back down should fail loudly
    // here rather than silently reintroducing the same intermittent error
    // screen.
    expect(COLD_START_RETRY_DELAYS_MS.length).toBeGreaterThanOrEqual(3)
    expect(COLD_START_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(7000)
  })
})
