import { expect, test } from '@playwright/test'
import { FAKE_SPACE_ID, FAKE_USER_ID, installSupabaseMock, makeFakeDb, seedSession, type FakeDb, type FakeTask } from './support/mockSupabase'

/** "Today" as the app itself sees it - the fake profile's own timezone. */
function appToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date())
}

function daysAgo(n: number): string {
  const [y, m, d] = appToday().split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10)
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
    points: 5, reminder_hour: 9, reminder_minute: 0, due_date: appToday(),
    last_completed_date: null, last_completed_at: null, last_completed_by: null, last_completed_actor: null,
    is_done: false, assigned_to: null, created_by: FAKE_USER_ID, created_at: new Date().toISOString(),
    starts_at: null, expires_at: null, reminder_policy: null, cancelled_at: null, expired_at: null,
    ...overrides,
  }
}

test('going on vacation freezes my own tasks, and coming back restarts them today', async ({ page }) => {
  const db = makeFakeDb({
    tasks: [
      task('mine', 'להשקות עציצים', { assigned_to: FAKE_USER_ID, due_date: daysAgo(3) }),
      task('shared', 'להוציא זבל'),
    ],
  })
  await seed(page, db)
  await page.goto('/')
  await expect(page.locator('.task-late', { hasText: 'להשקות עציצים' })).toBeVisible()

  await page.getByRole('button', { name: 'עוד' }).click()
  await page.getByRole('button', { name: 'יציאה לחופשה' }).click()
  await expect(page.getByText('מצב חופשה הופעל. נסיעה טובה!')).toBeVisible()
  expect(db.pauses).toHaveLength(1)
  expect(db.pauses[0].user_id).toBe(FAKE_USER_ID)

  await page.locator('.tab-bar').getByRole('button', { name: 'היום' }).click()
  await expect(page.locator('.vacation-banner')).toContainText('מצב חופשה')
  // My task is frozen - out of the late group, not counted as waiting...
  await expect(page.locator('.task-late')).toHaveCount(0)
  const frozen = page.locator('.paused-group')
  await expect(frozen.locator('summary')).toContainText('(1)')
  // ...while the shared one carries on for whoever is home.
  await expect(page.locator('.task-due', { hasText: 'להוציא זבל' })).toBeVisible()
  await expect(page.getByText('משימה אחת ממתינה')).toBeVisible()

  await page.locator('.vacation-banner').getByRole('button', { name: 'חזרתי' }).click()
  await expect(page.getByText('ברוכים השבים! המשימות מתחילות מחדש מהיום.')).toBeVisible()
  await expect(page.locator('.vacation-banner')).toHaveCount(0)
  // Restarted on the day of return: due today, not three days late.
  expect(db.tasks.find((t) => t.id === 'mine')?.due_date).toBe(appToday())
  await expect(page.locator('.task-due', { hasText: 'להשקות עציצים' })).toBeVisible()
  await expect(page.locator('.task-late')).toHaveCount(0)
})

test('a whole-space vacation freezes everything, shared tasks included', async ({ page }) => {
  const db = makeFakeDb({
    tasks: [task('a', 'להשקות עציצים', { due_date: daysAgo(2) }), task('b', 'להוציא זבל')],
    pauses: [{ id: 'p1', space_id: FAKE_SPACE_ID, user_id: null, started_on: daysAgo(5), ended_on: null }],
  })
  await seed(page, db)
  await page.goto('/')

  await expect(page.locator('.vacation-banner')).toContainText('"הבית" במצב חופשה')
  await expect(page.locator('.paused-group summary')).toContainText('(2)')
  await expect(page.locator('.task-late, .task-due')).toHaveCount(0)

  // The owner ends it for everyone, from the Space screen too.
  await page.getByRole('button', { name: 'עוד' }).click()
  await expect(page.locator('.vacation-card')).toContainText('כל המרחב בחופשה')
  await page.locator('.vacation-card').getByRole('button', { name: 'חזרנו' }).click()
  await expect(page.getByText('ברוכים השבים! המשימות מתחילות מחדש מהיום.')).toBeVisible()
  expect(db.tasks.every((t) => t.due_date === appToday())).toBe(true)
  expect(db.pauses[0].ended_on).toBe(appToday())
})

test('the owner confirms before sending the whole space on vacation', async ({ page }) => {
  const db = makeFakeDb({ tasks: [task('a', 'להשקות עציצים')] })
  await seed(page, db)
  await page.goto('/')
  await page.getByRole('button', { name: 'עוד' }).click()

  await page.locator('.vacation-card').getByRole('button', { name: 'חופשה לכל המרחב' }).click()
  const sheet = page.locator('.sheet', { hasText: 'חופשה לכל המרחב' })
  await sheet.getByRole('button', { name: 'חופשה לכל המרחב' }).click()
  await expect(page.getByText('כל המרחב עבר למצב חופשה.')).toBeVisible()
  expect(db.pauses).toEqual([expect.objectContaining({ user_id: null, ended_on: null })])
})

test('only the owner can end a whole-space vacation', async ({ page }) => {
  const db = makeFakeDb({
    selfRole: 'member',
    tasks: [task('a', 'להשקות עציצים')],
    pauses: [{ id: 'p1', space_id: FAKE_SPACE_ID, user_id: null, started_on: daysAgo(1), ended_on: null }],
  })
  db.spaces[0].created_by = 'someone-else'
  await seed(page, db)
  await page.goto('/')

  await expect(page.locator('.vacation-banner')).toBeVisible()
  await expect(page.locator('.vacation-banner').getByRole('button')).toHaveCount(0)
  await page.getByRole('button', { name: 'עוד' }).click()
  await expect(page.locator('.vacation-card').getByRole('button', { name: 'חזרנו' })).toHaveCount(0)
  await expect(page.locator('.vacation-card')).toContainText('רק מנהל המרחב')
})
