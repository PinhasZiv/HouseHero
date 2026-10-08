import { expect, test } from '@playwright/test'
import { FAKE_SPACE_ID, FAKE_USER_ID, installSupabaseMock, makeFakeDb, seedSession, type FakeDb, type FakeTask } from './support/mockSupabase'

/** "Today" as the app itself sees it - the fake profile's own timezone. */
function appToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date())
}

async function seed(page: import('@playwright/test').Page, db: FakeDb) {
  await seedSession(page)
  await page.addInitScript(() => window.localStorage.setItem('househero.language', 'he'))
  await installSupabaseMock(page, db)
}

function task(id: string, title: string, overrides: Partial<FakeTask> = {}): FakeTask {
  return {
    id, space_id: FAKE_SPACE_ID, title, description: null,
    task_type: 'recurring', recurrence_mode: 'interval', interval_days: 1, weekly_days: null,
    end_condition: 'never', end_after_count: null, end_date: null, occurrences_completed: 0,
    points: 5, reminder_hour: 9, reminder_minute: 0, due_date: appToday(),
    last_completed_date: null, last_completed_at: null, last_completed_by: null, last_completed_actor: null,
    is_done: false, assigned_to: null, created_by: FAKE_USER_ID, created_at: new Date().toISOString(),
    starts_at: null, expires_at: null, reminder_policy: null, cancelled_at: null, expired_at: null,
    ...overrides,
  }
}

test('opening the app from a notification about one task calls that card out', async ({ page }) => {
  const db = makeFakeDb({ tasks: [task('t-1', 'לשטוף כלים'), task('t-2', 'להוציא זבל')] })
  await seed(page, db)
  await page.goto(`/?space=${FAKE_SPACE_ID}&task=t-2`)

  const card = page.locator('[data-task-id="t-2"]')
  await expect(card).toHaveClass(/task-highlight/)
  await expect(page.locator('[data-task-id="t-1"]')).not.toHaveClass(/task-highlight/)
  // One-shot: the parameter is gone, so a reload does not call it out again.
  expect(new URL(page.url()).searchParams.has('task')).toBe(false)
  // And it fades on its own.
  await expect(card).not.toHaveClass(/task-highlight/, { timeout: 5000 })
})

test('a task can be added straight from Today', async ({ page }) => {
  const db = makeFakeDb({ tasks: [task('t-1', 'לשטוף כלים')] })
  await seed(page, db)
  await page.goto('/')
  await expect(page.locator('.task-card', { hasText: 'לשטוף כלים' })).toBeVisible()

  await page.getByRole('button', { name: 'הוספת משימה' }).click()
  const form = page.getByRole('dialog', { name: 'משימה חדשה' })
  await expect(form).toBeVisible()
  await page.locator('#task-title').fill('לנקות את המקרר')
  await form.getByRole('button', { name: 'הוספת משימה' }).click()

  await expect(form).toHaveCount(0)
  // Due today by default, so it lands right here - still on Today.
  await expect(page.locator('.task-card', { hasText: 'לנקות את המקרר' })).toBeVisible()
  await expect(page.locator('.tab-bar').getByRole('button', { name: 'היום' })).toHaveAttribute('aria-current', 'page')
  expect(db.tasks.map((t) => t.title)).toContain('לנקות את המקרר')
})

test('snoozing until the morning puts the reminder off to the next 08:00', async ({ page }) => {
  const db = makeFakeDb({ tasks: [task('t-1', 'לשטוף כלים')] })
  await seed(page, db)
  await page.goto('/')

  await page.locator('.task-card', { hasText: 'לשטוף כלים' }).getByRole('button', { name: /השהיית התזכורת/ }).click()
  const sheet = page.getByRole('dialog', { name: /השהיית תזכורת/ })
  await sheet.getByRole('button', { name: 'בבוקר ב-08:00' }).click()

  await expect(sheet).toHaveCount(0)
  const until = db.snoozes.get('t-1')
  expect(until).toBeTruthy()
  const local = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(until!))
  expect(local).toBe('08:00')
  expect(new Date(until!).getTime()).toBeGreaterThan(Date.now())
})
