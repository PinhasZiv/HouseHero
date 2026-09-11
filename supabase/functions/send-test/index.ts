// "Send me a test notification" from the Settings screen.
//
// Push has a lot of quiet failure modes - permission granted but the service
// worker never registered, a subscription the browser dropped, VAPID keys that
// do not match the ones the app was built with. Rather than have someone wait
// until a task is due to find out, this sends one push to the caller's own
// devices, right now, and reports exactly what the push service said.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { loadConfig } from '../_shared/config.ts'
import { TEST_NOTIFICATION, isLanguage, type Language } from '../_shared/messages.ts'
import { sendPush } from '../_shared/webpush.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const authorization = request.headers.get('Authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) return json({ error: 'not authenticated' }, 401)

  // Resolve the caller from their own JWT: a person can only test their own
  // devices, never anybody else's.
  const asUser = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } },
  )
  const { data: userData, error: userError } = await asUser.auth.getUser()
  if (userError || !userData.user) return json({ error: 'not authenticated' }, 401)

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  )

  const config = await loadConfig(admin)
  if (!config) return json({ error: 'not_configured' }, 500)

  // The test notification is the one that proves the setup works, so it had
  // better arrive in the language the person is looking at.
  const { data: profile } = await admin
    .from('profiles')
    .select('language')
    .eq('id', userData.user.id)
    .single()
  const stored: unknown = profile?.language
  const language: Language = isLanguage(stored) ? stored : 'he'

  const { data: subs, error } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userData.user.id)

  if (error) return json({ error: error.message }, 500)
  if (!subs?.length) return json({ error: 'no_subscriptions' }, 404)

  const results = []
  for (const sub of subs) {
    const result = await sendPush(
      sub,
      {
        ...TEST_NOTIFICATION[language],
        tag: 'househero-test',
        lang: language,
        dir: language === 'he' ? 'rtl' : 'ltr',
        test: true,
      },
      config.vapid,
    )
    if (!result.ok && result.gone) {
      await admin.from('push_subscriptions').delete().eq('id', sub.id)
    }
    results.push({ status: result.status, ok: result.ok })
  }

  const delivered = results.filter((r) => r.ok).length
  return json({ ok: delivered > 0, delivered, devices: results.length, results })
})
