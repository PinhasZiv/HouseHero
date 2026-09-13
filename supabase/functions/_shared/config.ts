// Server-side settings, read from the database rather than from Edge Function
// secrets.
//
// It is the same trust boundary either way - both are reachable only with the
// service-role key - but it means the whole install is one SQL script with two
// values in it, instead of a SQL script plus four secrets typed into a
// dashboard. Fewer places to mistype something that fails silently at 7pm.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import type { VapidKeys } from './webpush.ts'

export interface AppConfig {
  vapid: VapidKeys
  cronSecret: string
}

// A gateway timeout talking to Postgres from inside the function - a
// transient infra blip, seen once in practice right as send-assignment ran -
// looks identical to a genuinely missing app_config row: both come back as
// `error` here. Without a retry, that one blip silently failed the whole
// notification with no visible trace anywhere (the client only logs it to
// its own console), which is worse than the config actually being missing -
// that case is at least permanent and shows up on every call. A few retries
// tell the two apart: a real setup problem still fails after all of them,
// but a one-off timeout clears within a second or two.
const RETRY_DELAYS_MS = [0, 500, 1500]

export async function loadConfig(admin: SupabaseClient): Promise<AppConfig | null> {
  let lastError: unknown = null

  for (const delayMs of RETRY_DELAYS_MS) {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs))

    const { data, error } = await admin
      .from('app_config')
      .select('vapid_public_key, vapid_private_key, vapid_subject, cron_secret')
      .single()

    if (!error && data) {
      return {
        vapid: {
          publicKey: data.vapid_public_key,
          privateKey: data.vapid_private_key,
          subject: data.vapid_subject,
        },
        cronSecret: data.cron_secret,
      }
    }
    lastError = error
  }

  console.error('app_config is missing - has the setup SQL been run?', lastError)
  return null
}
