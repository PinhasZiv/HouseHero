// Fired once, right when a task is assigned to a specific person - not the
// recurring "it's due" reminder send-reminders handles later. The client
// calls this immediately after creating or editing a task whose assignment
// changed to someone other than whoever just saved it; assigning a task to
// "everyone" (assigned_to left empty) never calls this at all.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { loadConfig } from '../_shared/config.ts'
import { composeAssignment, isLanguage, type Language } from '../_shared/messages.ts'
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

  // Resolve the caller from their own JWT, and load the task through their
  // own client rather than the admin one: the `tasks` SELECT policy already
  // requires space membership, so this doubles as the only authorization
  // check this function needs - no separate is_member() call.
  const asUser = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } },
  )
  const { data: userData, error: userError } = await asUser.auth.getUser()
  if (userError || !userData.user) return json({ error: 'not authenticated' }, 401)

  let body: { taskId?: unknown }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'invalid_body' }, 400)
  }
  if (typeof body.taskId !== 'string' || !body.taskId) return json({ error: 'invalid_body' }, 400)

  const { data: task, error: taskError } = await asUser
    .from('tasks')
    .select('id, title, assigned_to')
    .eq('id', body.taskId)
    .single()
  if (taskError || !task) return json({ error: 'no_such_task' }, 404)

  // Assigned to everyone, or to whoever is asking - nothing to send. The
  // client already checks this before calling, but a stale task snapshot on
  // its side (or a direct hit on this endpoint) should still no-op quietly
  // rather than push someone a notification about their own action.
  if (!task.assigned_to || task.assigned_to === userData.user.id) {
    return json({ ok: true, skipped: true })
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  )

  const config = await loadConfig(admin)
  if (!config) return json({ error: 'not_configured' }, 500)

  const [assigneeProfile, byProfile, subs] = await Promise.all([
    admin.from('profiles').select('language').eq('id', task.assigned_to).single(),
    admin.from('profiles').select('display_name, email').eq('id', userData.user.id).single(),
    admin.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', task.assigned_to),
  ])

  if (!subs.data?.length) return json({ ok: true, delivered: 0, devices: 0 })

  const language: Language = isLanguage(assigneeProfile.data?.language) ? assigneeProfile.data.language : 'he'
  const byName = byProfile.data?.display_name || byProfile.data?.email || null
  const { title, body: pushBody } = composeAssignment(task.title, byName, language)

  let delivered = 0
  for (const sub of subs.data) {
    const result = await sendPush(
      sub,
      {
        title,
        body: pushBody,
        lang: language,
        dir: language === 'he' ? 'rtl' : 'ltr',
        // One tag per task: a reassignment before the first push is even
        // opened replaces it in the tray instead of stacking a second copy.
        tag: `househero-assigned-${task.id}`,
        taskId: task.id,
      },
      config.vapid,
    )
    if (result.ok) delivered++
    else if (result.gone) await admin.from('push_subscriptions').delete().eq('id', sub.id)
  }

  return json({ ok: true, delivered, devices: subs.data.length })
})
