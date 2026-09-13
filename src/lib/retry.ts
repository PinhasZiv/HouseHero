/**
 * Retries a flaky async operation with a short, increasing pause between
 * attempts - not to work around a real failure, but because a cold start
 * (opening a backgrounded PWA, or a network interface waking back up after a
 * WiFi/LTE handoff) can lose the very first request to something that clears
 * up within a few seconds on its own. A single 1.2s retry cleared the fast
 * case but still left the slower reconnects on a real error screen, so this
 * takes a list of delays rather than one fixed pause.
 */
export async function withRetry<T>(fn: () => Promise<T>, delaysMs: number[]): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (cause) {
      if (attempt >= delaysMs.length) throw cause
      await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]))
    }
  }
}

/**
 * How long to keep silently retrying a cold-start fetch (the initial data
 * load, and restoring a push subscription) before finally showing an error.
 * Two retries at 1.2s/2.5s (under 4s total) still occasionally lost to a
 * slower reconnect - a spotty connection recovering, not just a WiFi/LTE
 * handoff - so this adds a third, longer attempt: four tries in total,
 * spread over up to 10s, before giving up and showing a real error screen.
 */
export const COLD_START_RETRY_DELAYS_MS = [1000, 2000, 4000]
