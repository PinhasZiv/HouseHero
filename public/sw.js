/* HouseHero service worker.
 *
 * Two jobs:
 *   1. Receive push messages while the app is closed and show the notification.
 *   2. Open (or focus) the app on the "due today" list when that notification
 *      is tapped.
 *
 * Caching is deliberately modest. The app is useless without the network
 * anyway, so the cache exists to make a warm start instant, not to fake an
 * offline mode that would show stale task state.
 */

// Stamped with a hash of the build at build time (scripts/swVersion.ts), so
// each deploy gets a fresh cache - see 'activate' below for what is dropped.
const CACHE = 'househero-v1'
const SCOPE_PATH = new URL(self.registration.scope).pathname
// Remembers which cache the version before this one used, so it survives
// exactly one deploy - see 'activate'.
const META_CACHE = 'househero-meta'
const META_KEY = `${SCOPE_PATH}__househero_meta__`

// The notification body/title come from the server already worded in the
// person's own language (see supabase/functions/_shared/messages.ts), but the
// action button titles are drawn locally - they never went through that path,
// so they need their own tiny lookup by the same `lang` field.
const ACTION_LABELS = {
  he: { open: 'פתיחת הרשימה', snooze: 'השהיה' },
  en: { open: 'Open list', snooze: 'Snooze' },
}

/**
 * The app shell from the server itself, never the browser's HTTP cache.
 * GitHub Pages lets browsers reuse a page for 10 minutes, so a plain fetch
 * right after a deploy could hand back the previous version's HTML - which
 * names files the deploy just removed. That was the white screen. Revalidating
 * costs one small request (a 304 when nothing changed).
 */
function fetchFresh(url) {
  return fetch(url, { cache: 'no-cache', credentials: 'same-origin' })
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        fetchFresh(SCOPE_PATH).then((response) => (response.ok ? cache.put(SCOPE_PATH, response) : undefined)),
      )
      .catch(() => {}),
  )
  self.skipWaiting()
})

// Keeps this version's cache and the one before it, and drops anything older.
// Dropping the previous one right away used to strand a copy of the app still
// open on that version (or one whose page came from the HTTP cache): its
// files were gone from the phone and, after the deploy, from the server too.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const meta = await caches.open(META_CACHE)
      const saved = await meta.match(META_KEY)
      const record = saved ? await saved.json().catch(() => ({})) : {}
      const previous = record.current && record.current !== CACHE ? record.current : (record.previous ?? null)
      const keep = new Set([CACHE, META_CACHE, previous].filter(Boolean))
      const keys = await caches.keys()
      await Promise.all(keys.filter((key) => !keep.has(key)).map((key) => caches.delete(key)))
      await meta.put(META_KEY, new Response(JSON.stringify({ current: CACHE, previous })))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return // never cache Supabase calls

  // Navigations: the newest shell from the server, so a deploy is picked up
  // at once; the cached one only when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetchFresh(request.url)
        // A navigation may not be answered with a redirected response; let
        // the browser follow any redirect itself.
        .then((response) => (response.redirected ? fetch(request) : response))
        .then((response) => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(CACHE).then((cache) => cache.put(SCOPE_PATH, copy)).catch(() => {})
          }
          return response
        })
        // This version's own shell first - the previous one is still cached.
        .catch(() =>
          caches
            .open(CACHE)
            .then((cache) => cache.match(SCOPE_PATH))
            .then((hit) => hit || caches.match(SCOPE_PATH))
            .then((hit) => hit || Response.error()),
        ),
    )
    return
  }

  // Built assets carry a content hash in the filename, so a cache hit - in
  // this version's cache or the previous one's - is always the right answer.
  if (/\.(js|css|png|svg|webmanifest|woff2?)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            // Never keep an error: a 404 cached once would stay a 404.
            if (response.ok) {
              const copy = response.clone()
              caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {})
            }
            return response
          }),
      ),
    )
  }
})

/** Where tapping the notification lands: its space, and - when it is about
 *  one task, or belongs on a specific tab (a reward request) - that too. */
function notificationUrl(payload) {
  const params = new URLSearchParams()
  if (payload.spaceId) params.set('space', payload.spaceId)
  if (payload.taskId) params.set('task', payload.taskId)
  if (payload.tab) params.set('tab', payload.tab)
  const query = params.toString()
  return query ? `${SCOPE_PATH}?${query}` : SCOPE_PATH
}

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { title: 'HouseHero', body: event.data ? event.data.text() : '' }
  }

  const title = payload.title || 'יש משימה שמחכה'
  // A notification that points at a tab (a reward request, the weekly
  // summary) is news, not a due task: nothing to snooze, nothing to keep
  // pinned to the tray.
  const informational = Boolean(payload.test || payload.tab)
  const labels = ACTION_LABELS[payload.lang] || ACTION_LABELS.he
  const options = {
    body: payload.body || '',
    // The interface is Hebrew by default, so the notification is laid out
    // right to left too - otherwise the tray renders the punctuation on the
    // wrong side.
    lang: payload.lang || 'he',
    dir: payload.dir || 'rtl',
    // A stable tag replaces today's earlier notification instead of stacking.
    tag: payload.tag || 'househero',
    renotify: true,
    icon: `${SCOPE_PATH}icons/icon-192.png`,
    badge: `${SCOPE_PATH}icons/badge-96.png`,
    // A task reminder should survive a glance at the phone; it stays until
    // it is dealt with.
    requireInteraction: !informational,
    vibrate: [120, 60, 120],
    data: {
      spaceId: payload.spaceId || null,
      taskId: payload.taskId || null,
      url: notificationUrl(payload),
    },
    // A test notification has no real due tasks behind it, so the Snooze
    // action - which opens the app straight to a duration picker for
    // whatever is currently due - would just land on an empty picker.
    actions: informational
      ? [{ action: 'open', title: labels.open }]
      : [
          { action: 'open', title: labels.open },
          { action: 'snooze', title: labels.snooze },
        ],
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const base = (event.notification.data && event.notification.data.url) || SCOPE_PATH
  // The Snooze action opens straight into the in-app duration picker for
  // whatever is due right now - there is no single task to target from a
  // notification that can cover several at once, so the app decides which
  // tasks to offer once it is actually open, not this service worker.
  const target = event.action === 'snooze' ? base + (base.includes('?') ? '&' : '?') + 'snooze=1' : base

  event.waitUntil(openApp(new URL(target, self.location.origin).href))
})

// How long a window gets to answer focus() before the tap opens a fresh one.
const FOCUS_TIMEOUT_MS = 1500

function isPhone() {
  const data = self.navigator.userAgentData
  if (data && typeof data.mobile === 'boolean') return data.mobile
  return /Android|iPhone|iPad|iPod|Mobile/i.test(self.navigator.userAgent || '')
}

/**
 * Brings the app up at `url` after a notification tap.
 *
 * Chrome grants the tap a single "window interaction", and focus() and
 * openWindow() each spend it - so whichever is called first is the only one
 * that can bring a window up. On a phone, focus() on an app sitting in the
 * background (or frozen there by Android) can fail or never answer, leaving
 * the tap with no result at all. openWindow() is how the phone launches the
 * installed app at a URL, running or not, so that is the one used there.
 * focus() is kept for an app already on screen, and for desktops, where it
 * brings the existing window forward instead of opening another.
 */
async function openApp(url) {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const app = windows.find((client) => new URL(client.url).pathname.startsWith(SCOPE_PATH))
  if (!app || (isPhone() && app.visibilityState !== 'visible')) return self.clients.openWindow(url)

  const focused = await Promise.race([
    app.focus().catch(() => null),
    new Promise((resolve) => setTimeout(() => resolve(null), FOCUS_TIMEOUT_MS)),
  ])
  // Chrome has spent the tap by now, but other browsers may still allow this.
  if (!focused) return self.clients.openWindow(url).catch(() => null)

  try {
    return await focused.navigate(url)
  } catch {
    // navigate() only works on a page this worker controls - one opened
    // before the worker took over is asked to go there itself (see main.tsx).
    focused.postMessage({ type: 'open-url', url })
    return focused
  }
}
