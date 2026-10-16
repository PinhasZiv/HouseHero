import { expect, test } from '@playwright/test'
import { FAKE_SPACE_ID, FAKE_USER_ID, installSupabaseMock, makeFakeDb, seedSession, type FakeDb, type FakeTask } from './support/mockSupabase'

/** "Today" as the app itself sees it - the fake profile's own timezone. */
function appToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date())
}

function shift(n: number): string {
  const [y, m, d] = appToday().split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

async function seed(page: import('@playwright/test').Page, db: FakeDb) {
  await seedSession(page)
  await page.addInitScript(() => window.localStorage.setItem('househero.language', 'he'))
  await installSupabaseMock(page, db)
}

function task(id: string, title: string, overrides: Partial<FakeTask> = {}): FakeTask {
  return {
    id, space_id: FAKE_SPACE_ID, title, description: null,
    task_type: 'recurring', recurrence_mode: 'interval', interval_days: 7, weekly_days: null,
    end_condition: 'never', end_after_count: null, end_date: null, occurrences_completed: 0,
    points: 5, reminder_hour: 9, reminder_minute: 0, due_date: shift(-1),
    last_completed_date: null, last_completed_at: null, last_completed_by: null, last_completed_actor: null,
    is_done: false, assigned_to: null, created_by: FAKE_USER_ID, created_at: new Date().toISOString(),
    starts_at: null, expires_at: null, reminder_policy: null, cancelled_at: null, expired_at: null,
    ...overrides,
  }
}

async function completeYesterday(page: import('@playwright/test').Page, title: string) {
  await page.locator('.task-card', { hasText: title }).getByRole('button', { name: new RegExp(`סימון ${title}`) }).click()
  const sheet = page.getByRole('dialog', { name: 'מי ביצע את זה?' })
  await sheet.getByRole('button', { name: 'לתעד עבור זמן אחר' }).click()
  await sheet.locator('input[type="datetime-local"]').fill(`${shift(-1)}T20:00`)
  await sheet.getByRole('button', { name: 'אישור' }).click()
  await expect(sheet).toHaveCount(0)
}

test('a task marked done today for yesterday stays in "done today", and can be undone', async ({ page }) => {
  const db = makeFakeDb({ tasks: [task('t', 'להשקות עציצים')] })
  await seed(page, db)
  await page.goto('/')

  await completeYesterday(page, 'להשקות עציצים')
  expect(db.taskCompletions[0].completed_on).toBe(shift(-1))

  const done = page.locator('.completed-group')
  await done.locator('summary').click()
  const card = done.locator('.task-card', { hasText: 'להשקות עציצים' })
  await expect(card).toContainText('בוצעה על ידך')
  await expect(card).toContainText('אתמול')

  await card.getByRole('button', { name: /ביטול הביצוע של להשקות עציצים/ }).click()
  await expect(page.locator('.toast')).toContainText('בוטל הביצוע')
  expect(db.taskCompletions).toHaveLength(0)
  await expect(page.locator('.task-card', { hasText: 'להשקות עציצים' }).locator('.badge-late')).toBeVisible()
})

test('it is still there after reopening the app the same day', async ({ page }) => {
  const db = makeFakeDb({
    // Done yesterday evening, but marked a few minutes ago.
    tasks: [
      task('t', 'לקפל כביסה', {
        task_type: 'one_time', recurrence_mode: null, interval_days: null, is_done: true,
        last_completed_date: shift(-1), last_completed_at: `${shift(-1)}T17:00:00Z`,
        last_completed_by: [FAKE_USER_ID], last_completed_actor: FAKE_USER_ID, occurrences_completed: 1,
      }),
    ],
    taskCompletions: [{
      id: 'c', task_id: 't', user_id: FAKE_USER_ID, points_awarded: 5, completed_on: shift(-1),
      created_at: `${shift(-1)}T17:00:00Z`, logged_at: new Date().toISOString(), completion_group: null, prev_due_date: shift(-1),
    }],
  })
  await seed(page, db)
  await page.goto('/')

  await page.locator('.completed-group summary').click()
  const card = page.locator('.completed-group .task-card', { hasText: 'לקפל כביסה' })
  await expect(card).toContainText('אתמול')
  await expect(card.getByRole('button', { name: /ביטול הביצוע של לקפל כביסה/ })).toBeEnabled()
})

test('a completion marked yesterday is not "done today"', async ({ page }) => {
  const db = makeFakeDb({
    tasks: [task('t', 'לקפל כביסה', {
      due_date: shift(6), last_completed_date: shift(-1), last_completed_at: `${shift(-1)}T17:00:00Z`,
      last_completed_by: [FAKE_USER_ID], last_completed_actor: FAKE_USER_ID,
    })],
    taskCompletions: [{
      id: 'c', task_id: 't', user_id: FAKE_USER_ID, points_awarded: 5, completed_on: shift(-1),
      created_at: `${shift(-1)}T17:00:00Z`, logged_at: `${shift(-1)}T17:00:00Z`, completion_group: null, prev_due_date: shift(-1),
    }],
  })
  await seed(page, db)
  await page.goto('/')
  await expect(page.locator('.completed-group')).toHaveCount(0)
})
