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

export async function loadConfig(admin: SupabaseClient): Promise<AppConfig | null> {
  const { data, error } = await admin
    .from('app_config')
    .select('vapid_public_key, vapid_private_key, vapid_subject, cron_secret')
    .single()

  if (error || !data) {
    console.error('app_config is missing - has the setup SQL been run?', error)
    return null
  }

  return {
    vapid: {
      publicKey: data.vapid_public_key,
      privateKey: data.vapid_private_key,
      subject: data.vapid_subject,
    },
    cronSecret: data.cron_secret,
  }
}
