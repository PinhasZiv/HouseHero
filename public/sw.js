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

const CACHE = 'househero-v1'
const SCOPE_PATH = new URL(self.registration.scope).pathname

// The notification body/title come from the server already worded in the
// person's own language (see supabase/functions/_shared/messages.ts), but the
// action button titles are drawn locally - they never went through that path,
// so they need their own tiny lookup by the same `lang` field.
const ACTION_LABELS = {
  he: { open: 'פתיחת הרשימה', snooze: 'השהיה' },
  en: { open: 'Open list', snooze: 'Snooze' },
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(SCOPE_PATH)).catch(() => {}))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return // never cache Supabase calls

  // Navigations: try the network so a deploy is picked up immediately, and fall
  // back to the cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put(SCOPE_PATH, copy)).catch(() => {})
          return response
        })
        .catch(() => caches.match(SCOPE_PATH).then((hit) => hit || Response.error())),
    )
    return
  }

  // Built assets carry a content hash in the filename, so a cache hit is always
  // the right answer for them.
  if (/\.(js|css|png|svg|webmanifest|woff2?)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            const copy = response.clone()
            caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {})
            return response
          }),
      ),
    )
  }
})

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { title: 'HouseHero', body: event.data ? event.data.text() : '' }
  }

  const title = payload.title || 'יש משימה שמחכה'
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
    requireInteraction: !payload.test,
    vibrate: [120, 60, 120],
    data: {
      spaceId: payload.spaceId || null,
      taskId: payload.taskId || null,
      url: payload.spaceId
        ? `${SCOPE_PATH}?space=${payload.spaceId}${payload.taskId ? `&task=${payload.taskId}` : ''}`
        : SCOPE_PATH,
    },
    // A test notification has no real due tasks behind it, so the Snooze
    // action - which opens the app straight to a duration picker for
    // whatever is currently due - would just land on an empty picker.
    actions: payload.test
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

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Prefer an already-open copy: focusing it keeps the person's place, and
      // navigating it applies the space/task from the notification.
      for (const client of clients) {
        if (new URL(client.url).pathname.startsWith(SCOPE_PATH)) {
          return client.focus().then((focused) => {
            if ('navigate' in focused) return focused.navigate(target).catch(() => focused)
            return focused
          })
        }
      }
      return self.clients.openWindow(target)
    }),
  )
})
