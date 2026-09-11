import { FunctionsHttpError } from '@supabase/supabase-js'
import { t } from './i18n'
import { VAPID_PUBLIC_KEY, supabase } from './supabase'

// Getting a browser subscribed to push is a four-step handshake, and each step
// can fail in a way the previous one does not predict. These helpers report
// which step you are on, so Settings can say something more useful than
// "notifications are off".

export type PushState =
  | 'unsupported' // no service worker or Push API (a desktop Safari, an old browser)
  | 'unconfigured' // the build has no VAPID key
  | 'denied' // the person said no; only they can undo this, in browser settings
  | 'prompt' // never asked
  | 'subscribed'

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  const raw = atob(padded)
  return Uint8Array.from(raw, (char) => char.charCodeAt(0))
}

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

/** True when the page is running as an installed app rather than a browser tab. */
export function isInstalled(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // Safari's non-standard flag, harmless to check on Android.
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  try {
    // BASE_URL keeps the scope correct when served from a GitHub Pages sub-path.
    return await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
    })
  } catch (error) {
    console.error('service worker registration failed', error)
    return null
  }
}

export async function currentPushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported'
  if (!VAPID_PUBLIC_KEY) return 'unconfigured'
  if (Notification.permission === 'denied') return 'denied'

  const registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL)
  const existing = await registration?.pushManager.getSubscription()
  // Permission alone is not enough: it can be granted while the subscription
  // was dropped, which is the state that looks fine and delivers nothing.
  return existing ? 'subscribed' : 'prompt'
}

/**
 * Asks for permission, subscribes, and stores the subscription so the server
 * can reach this device. Safe to call again - the endpoint is the primary key,
 * so re-subscribing updates rather than duplicates.
 */
export async function enablePush(userId: string): Promise<PushState> {
  if (!pushSupported()) return 'unsupported'
  if (!VAPID_PUBLIC_KEY) return 'unconfigured'

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'prompt'

  const registration = (await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL))
    ?? (await registerServiceWorker())
  if (!registration) return 'unsupported'
  await navigator.serviceWorker.ready

  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      // Non-visible pushes are not allowed on the web; every push we send shows
      // a notification, so this is simply true.
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
    }))

  const json = subscription.toJSON()
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: userId,
      endpoint: subscription.endpoint,
      p256dh: json.keys?.p256dh ?? '',
      auth: json.keys?.auth ?? '',
      user_agent: navigator.userAgent.slice(0, 300),
      failure_count: 0,
    },
    { onConflict: 'endpoint' },
  )
  if (error) throw error

  return 'subscribed'
}

/**
 * Whether it is safe to silently call enablePush() on app load, with no user
 * interaction: only when the OS-level permission was already decided (so
 * requestPermission() resolves immediately with no prompt) and the
 * subscription is not already in place.
 */
export function shouldAutoRestorePush(permission: NotificationPermission, state: PushState): boolean {
  return permission === 'granted' && state !== 'subscribed'
}

/**
 * A phone can wipe the site storage a push subscription lives in - and, as
 * happened here, the Supabase session with it - while leaving the
 * OS-level Notification permission grant untouched, since Chrome stores that
 * separately. When that happens the person sees "reminders are off" with no
 * idea why, even though nothing about their choice to allow notifications
 * changed. Call this once a signed-in session is confirmed: if permission is
 * still granted, it silently re-subscribes with no prompt of any kind.
 */
export async function restorePushIfGranted(userId: string): Promise<void> {
  if (!pushSupported() || !VAPID_PUBLIC_KEY) return
  if (!shouldAutoRestorePush(Notification.permission, await currentPushState())) return
  try {
    await enablePush(userId)
  } catch (error) {
    console.error('could not silently restore the push subscription', error)
  }
}

export async function disablePush(): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL)
  const subscription = await registration?.pushManager.getSubscription()
  if (!subscription) return

  await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint)
  await subscription.unsubscribe()
}

/**
 * When send-test returns a non-2xx status, supabase-js discards the response
 * body into `error` and leaves `data` null - so the { error: 'reason' } JSON
 * the function actually sent back has to be read from here instead. Anything
 * that is not a well-formed JSON body with a string `error` field reads as
 * `null`, which just falls through to the generic message.
 */
async function readFunctionErrorReason(error: FunctionsHttpError): Promise<string | null> {
  try {
    const body: unknown = await error.context.json()
    const reason = (body as { error?: unknown } | null)?.error
    return typeof reason === 'string' ? reason : null
  } catch {
    return null
  }
}

/** Asks the server to push one notification to this account's devices now. */
export async function sendTestNotification(): Promise<{ ok: boolean; message: string }> {
  const { data, error } = await supabase.functions.invoke('send-test', { body: {} })
  if (error) {
    // A non-2xx response (auth rejected, nothing to push to, the server-side
    // setup missing) is a FunctionsHttpError with the real reason inside its
    // body - collapsing every one of those into "could not reach the server"
    // was actively misleading. A true network/relay failure has no such body
    // to read, and is the one case that message is actually true for.
    if (error instanceof FunctionsHttpError) {
      const reason = await readFunctionErrorReason(error)
      if (reason === 'not authenticated') return { ok: false, message: t().settings.test.notSignedIn }
      if (reason === 'no_subscriptions') return { ok: false, message: t().settings.test.noSubscription }
      if (reason === 'not_configured') return { ok: false, message: t().settings.test.notConfigured }
      return { ok: false, message: t().settings.test.serverError }
    }
    return { ok: false, message: t().settings.test.noServer }
  }
  if (!data?.ok) return { ok: false, message: t().settings.test.rejected }
  return { ok: true, message: t().settings.test.sent(data.delivered, data.devices) }
}
