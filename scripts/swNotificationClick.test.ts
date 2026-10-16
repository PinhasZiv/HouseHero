import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

// Runs public/sw.js's notificationclick handler against simulated phones and
// desktops. Chrome grants a notification tap exactly one "window interaction"
// and both focus() and openWindow() spend it, so whichever the worker calls
// first is the only one that can bring a window up.

const here = import.meta.dirname ?? __dirname
const source = readFileSync(join(here, '..', 'public', 'sw.js'), 'utf8')
const ORIGIN = 'https://pinhasziv.github.io'
const APP = `${ORIGIN}/HouseHero/`
const PHONE = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

interface FakeClient {
  url: string
  visibilityState: 'visible' | 'hidden'
  focus: () => Promise<FakeClient | null>
  navigate: (url: string) => Promise<FakeClient | null>
  postMessage: (message: unknown) => void
}

interface Log {
  opened: string[]
  focused: number
  navigated: string[]
  messages: unknown[]
}

function appWindow(
  log: Log,
  overrides: Partial<Pick<FakeClient, 'visibilityState' | 'focus' | 'navigate'>> = {},
): FakeClient {
  const client: FakeClient = {
    url: APP,
    visibilityState: 'hidden',
    focus: async () => client,
    navigate: async (url) => {
      log.navigated.push(url)
      return client
    },
    postMessage: (message) => log.messages.push(message),
    ...overrides,
  }
  const focus = client.focus
  client.focus = () => {
    log.focused += 1
    return focus()
  }
  return client
}

async function tap(options: {
  userAgent: string
  windows: (log: Log) => FakeClient[]
  action?: string
  url?: string
}): Promise<Log> {
  const log: Log = { opened: [], focused: 0, navigated: [], messages: [] }
  const handlers: Record<string, (event: unknown) => void> = {}
  const windows = options.windows(log)
  const self = {
    registration: { scope: APP },
    location: new URL(`${APP}sw.js`),
    navigator: { userAgent: options.userAgent },
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      handlers[type] = handler
    },
    skipWaiting() {},
    clients: {
      matchAll: async () => windows,
      openWindow: async (url: string) => {
        log.opened.push(url)
        return null
      },
    },
  }
  runInNewContext(source, { self, caches: {}, fetch: async () => ({}), URL, URLSearchParams, Response, console, setTimeout, clearTimeout, Promise })

  let pending: Promise<unknown> = Promise.resolve()
  handlers.notificationclick({
    action: options.action ?? '',
    notification: { close() {}, data: { url: options.url ?? '/HouseHero/?space=s1&task=t1' } },
    waitUntil: (promise: Promise<unknown>) => {
      pending = promise
    },
  })
  await pending
  return log
}

const TARGET = `${APP}?space=s1&task=t1`

describe('tapping a notification', () => {
  it('opens the app at the task when it is not running', async () => {
    const log = await tap({ userAgent: PHONE, windows: () => [] })
    expect(log.opened).toEqual([TARGET])
  })

  it('on a phone, launches the app at the task when it sits in the background - without spending the tap on focus()', async () => {
    const log = await tap({ userAgent: PHONE, windows: (l) => [appWindow(l)] })
    expect(log.focused).toBe(0)
    expect(log.opened).toEqual([TARGET])
  })

  it('on a phone, launches the app even when the background copy is frozen and would never answer', async () => {
    const log = await tap({ userAgent: PHONE, windows: (l) => [appWindow(l, { focus: () => new Promise(() => {}) })] })
    expect(log.opened).toEqual([TARGET])
  })

  it('moves an app already on screen to the task, in place', async () => {
    const log = await tap({ userAgent: PHONE, windows: (l) => [appWindow(l, { visibilityState: 'visible' })] })
    expect(log.focused).toBe(1)
    expect(log.navigated).toEqual([TARGET])
    expect(log.opened).toEqual([])
  })

  it('on a desktop, brings the existing window forward instead of opening another', async () => {
    const log = await tap({ userAgent: DESKTOP, windows: (l) => [appWindow(l)] })
    expect(log.focused).toBe(1)
    expect(log.navigated).toEqual([TARGET])
    expect(log.opened).toEqual([])
  })

  it('opens a window when the existing one refuses to come forward', async () => {
    const log = await tap({
      userAgent: DESKTOP,
      windows: (l) => [appWindow(l, { focus: async () => { throw new Error('Not allowed to focus a window.') } })],
    })
    expect(log.opened).toEqual([TARGET])
  })

  it('opens a window when focus() answers with nothing', async () => {
    const log = await tap({ userAgent: DESKTOP, windows: (l) => [appWindow(l, { focus: async () => null })] })
    expect(log.opened).toEqual([TARGET])
  })

  it('does not wait forever on a window that never answers focus()', async () => {
    const log = await tap({ userAgent: DESKTOP, windows: (l) => [appWindow(l, { focus: () => new Promise(() => {}) })] })
    expect(log.opened).toEqual([TARGET])
  })

  it('asks the page to go to the task itself when the worker cannot navigate it', async () => {
    const log = await tap({
      userAgent: DESKTOP,
      windows: (l) => [appWindow(l, { navigate: async () => { throw new TypeError('This service worker is not the client\'s active service worker.') } })],
    })
    expect(log.messages).toEqual([{ type: 'open-url', url: TARGET }])
  })

  it('carries the Snooze action through to the app', async () => {
    const log = await tap({ userAgent: PHONE, windows: () => [], action: 'snooze' })
    expect(log.opened).toEqual([`${TARGET}&snooze=1`])
  })
})
