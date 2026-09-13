import type { Page, Route } from '@playwright/test'

// A small stand-in for the pieces of the Supabase REST/RPC API the app
// actually calls on the screens these tests exercise. It is not a general
// PostgREST clone - just enough query/filter/upsert/rpc support for profiles,
// spaces, tasks, task_snoozes, task_completions, rewards and
// reward_redemptions, which is what the api.ts functions issue.

export const FAKE_USER_ID = '11111111-1111-4111-8111-111111111111'
export const FAKE_SPACE_ID = '22222222-2222-4222-8222-222222222222'

export interface FakeTask {
  id: string
  space_id: string
  title: string
  description: string | null
  task_type: 'one_time' | 'recurring'
  recurrence_mode: 'interval' | 'weekly_days' | null
  interval_days: number | null
  weekly_days: number[] | null
  end_condition: 'never' | 'after_count' | 'on_date'
  end_after_count: number | null
  end_date: string | null
  occurrences_completed: number
  points: number
  reminder_hour: number
  reminder_minute: number
  due_date: string
  last_completed_date: string | null
  last_completed_by: string | null
  is_done: boolean
  assigned_to: string | null
  created_by: string
  created_at: string
}

export interface FakeReward {
  id: string
  space_id: string
  title: string
  description: string | null
  cost: number
  created_by: string
  created_at: string
}

export interface FakeRedemption {
  id: string
  space_id: string
  reward_id: string | null
  reward_title: string
  cost: number
  requested_by: string
  approved_by: string | null
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  requested_at: string
  decided_at: string | null
}

export interface FakeDb {
  profile: {
    id: string
    email: string | null
    display_name: string | null
    avatar_url: string | null
    timezone: string
    language: 'he' | 'en' | null
    lifetime_points: number
    spendable_points: number
  }
  spaces: { id: string; name: string; invite_code: string; created_by: string; created_at: string }[]
  tasks: FakeTask[]
  snoozes: Map<string, string> // task_id -> snoozed_until, this user only
  taskCompletions: { id: string; task_id: string; user_id: string; points_awarded: number; completed_on: string; created_at: string }[]
  rewards: FakeReward[]
  redemptions: FakeRedemption[]
  /** Other space members fetchPeople() should resolve names for. */
  otherPeople: { id: string; display_name: string | null; avatar_url: string | null; email: string | null; lifetime_points: number; spendable_points: number }[]
  /** Every send-assignment invocation this session made, in call order. */
  assignmentNotifications: { taskId: string }[]
}

export function makeFakeDb(overrides?: Partial<FakeDb>): FakeDb {
  return {
    profile: {
      id: FAKE_USER_ID,
      email: 'test@example.com',
      display_name: 'Test Person',
      avatar_url: null,
      timezone: 'Asia/Jerusalem',
      language: 'he',
      lifetime_points: 0,
      spendable_points: 0,
    },
    spaces: [
      {
        id: FAKE_SPACE_ID,
        name: 'הבית',
        invite_code: 'ABC123',
        created_by: FAKE_USER_ID,
        created_at: new Date().toISOString(),
      },
    ],
    tasks: [],
    snoozes: new Map(),
    taskCompletions: [],
    rewards: [],
    redemptions: [],
    otherPeople: [],
    assignmentNotifications: [],
    ...overrides,
  }
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

function eqValue(url: URL, column: string): string | null {
  const raw = url.searchParams.get(column)
  return raw?.startsWith('eq.') ? raw.slice(3) : null
}

/** Applies complete_task's rules well enough for the one_time/interval cases the suite exercises. */
function applyCompleteTask(db: FakeDb, taskId: string, today: string) {
  const task = db.tasks.find((t) => t.id === taskId)
  if (!task) return null

  const event = {
    id: `completion-${db.taskCompletions.length + 1}`,
    task_id: task.id,
    user_id: FAKE_USER_ID,
    points_awarded: task.points,
    completed_on: today,
    created_at: new Date().toISOString(),
  }
  db.taskCompletions.push(event)

  if (task.task_type === 'one_time') {
    task.is_done = true
  } else if (task.recurrence_mode === 'interval') {
    const next = new Date(today)
    next.setUTCDate(next.getUTCDate() + (task.interval_days ?? 1))
    task.due_date = next.toISOString().slice(0, 10)
  }
  task.last_completed_date = today
  task.last_completed_by = FAKE_USER_ID
  task.occurrences_completed += 1

  db.profile.lifetime_points += task.points
  db.profile.spendable_points += task.points

  return event
}

export async function installSupabaseMock(page: Page, db: FakeDb): Promise<void> {
  await page.route('**/rest/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const method = request.method()
    const wantsSingle = (request.headers()['accept'] ?? '').includes('vnd.pgrst.object')

    if (url.pathname.includes('/rpc/')) {
      const fn = url.pathname.split('/rpc/').pop()
      const body = request.postDataJSON() as Record<string, unknown>

      if (fn === 'complete_task') {
        const event = applyCompleteTask(db, body.p_task as string, body.p_today as string)
        if (!event) return json(route, { message: 'no_such_task' }, 404)
        return json(route, wantsSingle ? event : [event])
      }
      if (fn === 'request_redemption') {
        const reward = db.rewards.find((r) => r.id === body.p_reward)
        if (!reward) return json(route, { message: 'no_such_reward' }, 404)
        const redemption: FakeRedemption = {
          id: `redemption-${db.redemptions.length + 1}`,
          space_id: reward.space_id,
          reward_id: reward.id,
          reward_title: reward.title,
          cost: reward.cost,
          requested_by: FAKE_USER_ID,
          approved_by: null,
          status: 'pending',
          requested_at: new Date().toISOString(),
          decided_at: null,
        }
        db.redemptions.push(redemption)
        return json(route, wantsSingle ? redemption : [redemption])
      }
      if (fn === 'cancel_redemption') {
        const redemption = db.redemptions.find((r) => r.id === body.p_redemption)
        if (!redemption) return json(route, { message: 'no_such_redemption' }, 404)
        if (redemption.requested_by !== FAKE_USER_ID) return json(route, { message: 'not_your_request' }, 403)
        if (redemption.status !== 'pending') return json(route, { message: 'not_pending' }, 409)
        redemption.status = 'cancelled'
        redemption.decided_at = new Date().toISOString()
        return json(route, wantsSingle ? redemption : [redemption])
      }
      return json(route, { message: `unmocked rpc: ${fn}` }, 404)
    }

    const table = url.pathname.split('/').pop() ?? ''

    if (table === 'profiles' && method === 'GET') {
      const idFilter = eqValue(url, 'id')
      const select = url.searchParams.get('select') ?? ''
      if (idFilter && idFilter !== db.profile.id) return json(route, null, 406)
      if (select === '*' || idFilter) return json(route, wantsSingle ? db.profile : [db.profile])
      // fetchPeople: a narrower column set, always an array.
      const { id, display_name, avatar_url, email, lifetime_points, spendable_points } = db.profile
      return json(route, [{ id, display_name, avatar_url, email, lifetime_points, spendable_points }, ...db.otherPeople])
    }

    if (table === 'spaces' && method === 'GET') return json(route, db.spaces)

    if (table === 'space_members' && method === 'GET') {
      // fetchMembers() joins the profile inline, which is what the assignee
      // dropdown in TaskForm reads its options from - and that dropdown only
      // renders once there is someone else to assign to, so this has to
      // include the signed-in user as a member row too, not just otherPeople.
      const rows = [
        {
          space_id: FAKE_SPACE_ID,
          user_id: db.profile.id,
          role: 'owner',
          joined_at: new Date().toISOString(),
          profile: { id: db.profile.id, display_name: db.profile.display_name, avatar_url: db.profile.avatar_url, email: db.profile.email },
        },
        ...db.otherPeople.map((person) => ({
          space_id: FAKE_SPACE_ID,
          user_id: person.id,
          role: 'member',
          joined_at: new Date().toISOString(),
          profile: { id: person.id, display_name: person.display_name, avatar_url: person.avatar_url, email: person.email },
        })),
      ]
      return json(route, rows)
    }

    if (table === 'tasks' && method === 'GET') return json(route, db.tasks)

    if (table === 'tasks' && method === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>
      const newTask: FakeTask = {
        id: `task-${db.tasks.length + 1}`,
        occurrences_completed: 0,
        last_completed_date: null,
        last_completed_by: null,
        is_done: false,
        created_at: new Date().toISOString(),
        ...body,
      } as FakeTask
      db.tasks.push(newTask)
      return json(route, wantsSingle ? newTask : [newTask], 201)
    }

    if (table === 'tasks' && method === 'PATCH') {
      const taskId = eqValue(url, 'id')
      const task = db.tasks.find((t) => t.id === taskId)
      if (!task) return json(route, { message: 'no_such_task' }, 404)
      Object.assign(task, request.postDataJSON() as Record<string, unknown>)
      return json(route, wantsSingle ? task : [task])
    }

    if (table === 'task_snoozes') {
      if (method === 'GET') {
        const rows = [...db.snoozes.entries()].map(([task_id, snoozed_until]) => ({ task_id, snoozed_until }))
        return json(route, rows)
      }
      if (method === 'POST') {
        const body = request.postDataJSON() as { task_id: string; snoozed_until: string } | { task_id: string; snoozed_until: string }[]
        const rows = Array.isArray(body) ? body : [body]
        for (const row of rows) db.snoozes.set(row.task_id, row.snoozed_until)
        return json(route, [], 201)
      }
      if (method === 'DELETE') {
        const taskId = eqValue(url, 'task_id')
        if (taskId) db.snoozes.delete(taskId)
        return json(route, [])
      }
    }

    if (table === 'task_completions' && method === 'GET') {
      const taskId = eqValue(url, 'task_id')
      const rows = db.taskCompletions
        .filter((row) => row.task_id === taskId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
      return json(route, rows)
    }

    if (table === 'rewards' && method === 'GET') return json(route, db.rewards)

    if (table === 'reward_redemptions' && method === 'GET') return json(route, db.redemptions)

    if (table === 'push_subscriptions') return json(route, [])

    return json(route, { message: `unmocked request: ${method} ${url.pathname}${url.search}` }, 404)
  })

  await page.route('**/functions/v1/**', async (route) => {
    const fn = new URL(route.request().url()).pathname.split('/functions/v1/').pop()
    if (fn === 'send-assignment') {
      const body = route.request().postDataJSON() as { taskId: string }
      db.assignmentNotifications.push({ taskId: body.taskId })
      return json(route, { ok: true, delivered: 1, devices: 1 })
    }
    return json(route, { message: `unmocked function: ${fn}` }, 404)
  })

  // Realtime is best-effort in the app (a task list that just does not
  // live-update if the socket cannot connect), and the fake host this suite
  // points at cannot resolve at all - do not let that surface as a console
  // error that makes a failing assertion harder to read.
  await page.routeWebSocket('**/realtime/v1/**', () => {})
}

function base64Url(value: object): string {
  return Buffer.from(JSON.stringify(value))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/** A JWT-shaped (never verified anywhere in this mock) access token. */
function fakeAccessToken(userId: string): string {
  const now = Math.floor(Date.now() / 1000)
  const header = base64Url({ alg: 'HS256', typ: 'JWT' })
  const payload = base64Url({ sub: userId, role: 'authenticated', exp: now + 3600 })
  return `${header}.${payload}.fake-signature`
}

/**
 * Seeds the localStorage key supabase-js reads on `getSession()`, so the app
 * starts already signed in - no OAuth flow to fake.
 */
export async function seedSession(page: Page, userId: string = FAKE_USER_ID): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  const session = {
    access_token: fakeAccessToken(userId),
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    refresh_token: 'fake-refresh-token',
    user: {
      id: userId,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'test@example.com',
      app_metadata: {},
      user_metadata: {},
      created_at: new Date().toISOString(),
    },
  }
  // The default storage key is `sb-${hostname.split('.')[0]}-auth-token`,
  // matching the fake project host this suite configures Vite to use.
  await page.addInitScript(
    ({ key, value }) => window.localStorage.setItem(key, value),
    { key: 'sb-fake-project-auth-token', value: JSON.stringify(session) },
  )
}
