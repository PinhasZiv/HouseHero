import { expect, test } from '@playwright/test'
import { FAKE_SPACE_ID, FAKE_USER_ID, installSupabaseMock, makeFakeDb, seedSession, type FakeDb, type FakeTask } from './support/mockSupabase'

const DANA = { id: '33333333-3333-4333-8333-333333333333', display_name: 'דנה כהן', avatar_url: null, email: 'dana@example.com', lifetime_points: 0, spendable_points: 0 }

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

test.describe('the Today screen and tasks assigned to others', () => {
  test('hides tasks assigned to someone else by default, and shows them on request', async ({ page }) => {
    const db = makeFakeDb({
      otherPeople: [DANA],
      tasks: [
        task('t-mine', 'לסדר ארון', { assigned_to: FAKE_USER_ID }),
        task('t-everyone', 'להוציא זבל'),
        task('t-dana', 'לקנות חלב', { assigned_to: DANA.id }),
      ],
    })
    await seed(page, db)
    await page.goto('/')

    await expect(page.locator('.task-card', { hasText: 'לסדר ארון' })).toBeVisible()
    await expect(page.locator('.task-card', { hasText: 'להוציא זבל' })).toBeVisible()
    await expect(page.locator('.task-card', { hasText: 'לקנות חלב' })).toHaveCount(0)
    // The header count matches what this person is actually reminded about.
    await expect(page.locator('.screen-subtitle')).toContainText('2')

    await page.getByRole('button', { name: 'משימה אחת של אחרים מוסתרת · הצגה' }).click()
    await expect(page.locator('.task-card', { hasText: 'לקנות חלב' })).toBeVisible()

    // The choice sticks across a reload of the app.
    await page.reload()
    await expect(page.locator('.task-card', { hasText: 'לקנות חלב' })).toBeVisible()
    await page.getByRole('button', { name: 'הסתרת המשימות של אחרים' }).click()
    await expect(page.locator('.task-card', { hasText: 'לקנות חלב' })).toHaveCount(0)
  })

  test('offers no toggle when nothing is assigned to anyone else', async ({ page }) => {
    const db = makeFakeDb({ tasks: [task('t-everyone', 'להוציא זבל')] })
    await seed(page, db)
    await page.goto('/')

    await expect(page.locator('.task-card', { hasText: 'להוציא זבל' })).toBeVisible()
    await expect(page.locator('.link-button')).toHaveCount(0)
  })
})

test('the done section counts completions and skips separately', async ({ page }) => {
  const today = appToday()
  const db = makeFakeDb({
    tasks: [
      task('t-done', 'לשטוף כלים', {
        last_completed_date: today, last_completed_at: new Date().toISOString(),
        last_completed_by: [FAKE_USER_ID], last_completed_actor: FAKE_USER_ID, occurrences_completed: 1,
      }),
      task('t-skipped', 'להכניס מדיח', { last_skipped_date: today, last_skipped_by: FAKE_USER_ID }),
    ],
  })
  await seed(page, db)
  await page.goto('/')

  await expect(page.locator('.completed-summary')).toHaveText('בוצעו היום (1) · דולגה אחת')
})
