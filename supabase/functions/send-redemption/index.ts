// Fired once right after a reward request changes hands: a new request goes
// to everyone else in the space (one of them has to approve it), and an
// approval or rejection goes back to whoever asked. Before this, nobody found
// out about either unless they happened to open the Rewards tab.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { loadConfig } from '../_shared/config.ts'
import { composeRedemptionDecision, composeRedemptionRequest, isLanguage, type Language } from '../_shared/messages.ts'
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

  // Loaded through the caller's own client: the reward_redemptions SELECT
  // policy requires space membership, which is the authorization check.
  const asUser = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } },
  )
  const { data: userData, error: userError } = await asUser.auth.getUser()
  if (userError || !userData.user) return json({ error: 'not authenticated' }, 401)
  const callerId = userData.user.id

  let body: { redemptionId?: unknown }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'invalid_body' }, 400)
  }
  if (typeof body.redemptionId !== 'string' || !body.redemptionId) return json({ error: 'invalid_body' }, 400)

  const { data: redemption, error: redemptionError } = await asUser
    .from('reward_redemptions')
    .select('id, space_id, reward_title, cost, requested_by, status')
    .eq('id', body.redemptionId)
    .single()
  if (redemptionError || !redemption) return json({ error: 'no_such_redemption' }, 404)

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  )

  // Only the person who just acted sends the news, and only once: the
  // requester announces a new request, someone else announces a decision.
  let recipients: string[]
  if (redemption.status === 'pending' && redemption.requested_by === callerId) {
    const { data: members } = await admin.from('space_members').select('user_id').eq('space_id', redemption.space_id)
    recipients = (members ?? []).map((m: { user_id: string }) => m.user_id).filter((id: string) => id !== callerId)
  } else if (
    (redemption.status === 'approved' || redemption.status === 'rejected') &&
    redemption.requested_by !== callerId
  ) {
    recipients = [redemption.requested_by]
  } else {
    return json({ ok: true, skipped: true })
  }
  if (recipients.length === 0) return json({ ok: true, delivered: 0, devices: 0 })

  const config = await loadConfig(admin)
  if (!config) return json({ error: 'not_configured' }, 500)

  const [byProfile, recipientProfiles, subs] = await Promise.all([
    admin.from('profiles').select('display_name, email').eq('id', callerId).single(),
    admin.from('profiles').select('id, language').in('id', recipients),
    admin.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth').in('user_id', recipients),
  ])
  const byName = byProfile.data?.display_name || byProfile.data?.email || null
  const languageOf = new Map<string, Language>(
    (recipientProfiles.data ?? []).map((p: { id: string; language: unknown }) => [
      p.id,
      isLanguage(p.language) ? p.language : 'he',
    ]),
  )

  let delivered = 0
  for (const sub of subs.data ?? []) {
    const language = languageOf.get(sub.user_id) ?? 'he'
    const { title, body: pushBody } =
      redemption.status === 'pending'
        ? composeRedemptionRequest(redemption.reward_title, redemption.cost, byName, language)
        : composeRedemptionDecision(redemption.reward_title, redemption.status === 'approved', byName, language)
    const result = await sendPush(
      sub,
      {
        title,
        body: pushBody,
        lang: language,
        dir: language === 'he' ? 'rtl' : 'ltr',
        tag: `househero-redemption-${redemption.id}`,
        spaceId: redemption.space_id,
        tab: 'rewards',
      },
      config.vapid,
    )
    if (result.ok) delivered++
    else if (result.gone) await admin.from('push_subscriptions').delete().eq('id', sub.id)
  }

  return json({ ok: true, delivered, devices: subs.data?.length ?? 0 })
})
