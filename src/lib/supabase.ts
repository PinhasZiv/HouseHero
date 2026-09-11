import { createClient } from '@supabase/supabase-js'
import * as config from '../config'

/**
 * Strips a trailing API path off a pasted Supabase URL.
 *
 * Supabase's own dashboard shows "Project URL" right above "REST API URL",
 * which already has /rest/v1 appended - an easy pair to mix up when copying.
 * supabase-js appends its own paths (rest/v1, auth/v1, realtime/v1, ...), so a
 * base URL that already carries one breaks every request in a way that is not
 * obvious from the error alone. Normalizing here means a pasting mistake costs
 * nothing rather than an afternoon of debugging.
 */
export function normalizeSupabaseUrl(rawUrl: string): string {
  return rawUrl.replace(/\/(rest|auth|realtime|storage)\/v\d+\/?$/, '').replace(/\/+$/, '')
}

// Settings come from the committed src/config.ts so they can be filled in by
// editing one file in the GitHub web editor, with no build secrets to set up.
// Environment variables still win when present, which is what local development
// and any future private deployment would use.
const rawUrl = import.meta.env.VITE_SUPABASE_URL || config.SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || config.SUPABASE_ANON_KEY
const url = normalizeSupabaseUrl(rawUrl)

/**
 * False until the Supabase details are filled in. The app then renders a setup
 * screen rather than failing at the first request, which is what a fresh deploy
 * looks like before step 4 of SETUP.md.
 */
export const isConfigured =
  Boolean(url && anonKey) && !url.startsWith('PASTE_') && !anonKey.startsWith('PASTE_')

export const supabase = createClient(isConfigured ? url : 'http://localhost:54321', anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // The OAuth redirect comes back with the session in the URL fragment; this
    // picks it up and then cleans the address bar.
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
})

export const VAPID_PUBLIC_KEY =
  import.meta.env.VITE_VAPID_PUBLIC_KEY || config.VAPID_PUBLIC_KEY

/** Absolute URL of the app itself, respecting the GitHub Pages sub-path. */
export function appUrl(): string {
  return new URL(import.meta.env.BASE_URL, window.location.origin).href
}
