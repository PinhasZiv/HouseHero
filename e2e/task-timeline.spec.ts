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

function task(overrides: Partial<FakeTask> = {}): FakeTask {
  return {
    id: 't-1', space_id: FAKE_SPACE_ID, title: 'ניקוי שירותים', description: null,
    task_type: 'recurring', recurrence_mode: 'interval', interval_days: 7, weekly_days: null,
    end_condition: 'never', end_after_count: null, end_date: null, occurrences_completed: 0,
    points: 10, reminder_hour: 19, reminder_minute: 30, due_date: shift(7),
    last_completed_date: null, last_completed_at: null, last_completed_by: null, last_completed_actor: null,
    is_done: false, assigned_to: null, created_by: FAKE_USER_ID, created_at: new Date().toISOString(),
    starts_at: null, expires_at: null, reminder_policy: null, cancelled_at: null, expired_at: null,
    ...overrides,
  }
}

const DANA = { id: 'dana', display_name: 'דנה', avatar_url: null, email: null, lifetime_points: 0, spendable_points: 0 }

test('the history lists every cycle: done (by whom), skipped (by whom), missed, and vacations', async ({ page }) => {
  const db = makeFakeDb({
    otherPeople: [DANA],
    tasks: [task()],
    taskCompletions: [
      // Today, by me - 15 days after it was due: the two weeks before went by.
      { id: 'c2', task_id: 't-1', user_id: FAKE_USER_ID, points_awarded: 10, completed_on: appToday(), created_at: new Date().toISOString(), completion_group: null, prev_due_date: shift(-15) },
      // Earlier, by Dana, on time.
      { id: 'c1', task_id: 't-1', user_id: 'dana', points_awarded: 10, completed_on: shift(-29), created_at: `${shift(-29)}T16:00:00Z`, completion_group: null, prev_due_date: shift(-29) },
    ],
    taskSkips: [
      { id: 's1', task_id: 't-1', space_id: FAKE_SPACE_ID, user_id: 'dana', skipped_on: shift(-22), created_at: `${shift(-22)}T06:00:00Z`, prev_due_date: shift(-22), prev_last_skipped_date: null, prev_last_skipped_by: null, prev_is_done: false },
    ],
    pauses: [{ id: 'p1', space_id: FAKE_SPACE_ID, user_id: null, started_on: shift(-40), ended_on: shift(-33) }],
  })
  await seed(page, db)
  await page.goto('/')
  await page.locator('.tab-bar').getByRole('button', { name: 'משימות' }).click()
  await page.locator('.task-card', { hasText: 'ניקוי שירותים' }).locator('.task-main').click()

  const rows = page.getByRole('dialog', { name: 'ניקוי שירותים' }).locator('.history-row')
  await expect(rows).toHaveCount(6)
  await expect(rows.nth(0)).toHaveClass(/history-row-done/)
  await expect(rows.nth(0)).toContainText('בוצעה על ידך')
  await expect(rows.nth(1)).toHaveClass(/history-row-missed/)
  await expect(rows.nth(1)).toContainText('התפספסה')
  await expect(rows.nth(2)).toHaveClass(/history-row-missed/)
  await expect(rows.nth(3)).toContainText('דולגה על ידי דנה')
  await expect(rows.nth(4)).toContainText('בוצעה על ידי דנה')
  await expect(rows.nth(5)).toHaveClass(/history-row-vacation/)
  await expect(rows.nth(5)).toContainText('חופשה של כל המרחב')
})

test('a task overdue past a full cycle shows the occurrence that went by as missed', async ({ page }) => {
  const db = makeFakeDb({ tasks: [task({ due_date: shift(-8) })] })
  await seed(page, db)
  await page.goto('/')
  await page.locator('.task-card', { hasText: 'ניקוי שירותים' }).locator('.task-main').click()

  const rows = page.getByRole('dialog', { name: 'ניקוי שירותים' }).locator('.history-row')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('התפספסה')
})
