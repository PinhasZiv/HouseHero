import { expect, test } from '@playwright/test'
import { FAKE_SPACE_ID, FAKE_USER_ID, installSupabaseMock, makeFakeDb, seedSession, type FakeDb } from './support/mockSupabase'

function isoDaysFromToday(offset: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

async function seed(page: import('@playwright/test').Page, db: FakeDb) {
  await seedSession(page)
  await page.addInitScript(() => window.localStorage.setItem('househero.language', 'he'))
  await installSupabaseMock(page, db)
}

function dishes() {
  return {
    id: 'task-dishes', space_id: FAKE_SPACE_ID, title: 'לשטוף כלים', description: null,
    task_type: 'recurring' as const, recurrence_mode: 'interval' as const, interval_days: 1, weekly_days: null,
    end_condition: 'never' as const, end_after_count: null, end_date: null, occurrences_completed: 0,
    points: 5, reminder_hour: 9, reminder_minute: 0, due_date: isoDaysFromToday(0),
    last_completed_date: null, last_completed_at: null, last_completed_by: null, last_completed_actor: null,
    is_done: false, assigned_to: null, created_by: FAKE_USER_ID, created_at: new Date().toISOString(),
    starts_at: null, expires_at: null, reminder_policy: null, cancelled_at: null, expired_at: null,
  }
}

test.describe('losing the connection', () => {
  test('a failed refresh keeps the list on screen with a banner, and reconnecting clears it', async ({ page }) => {
    const db = makeFakeDb({ tasks: [dishes()] })
    await seed(page, db)
    await page.goto('/')
    await expect(page.locator('.task-card', { hasText: 'לשטוף כלים' })).toBeVisible()

    // Any failed action triggers a refresh; with the server failing, that
    // refresh fails too, after its retries.
    db.failing = true
    await page.locator('.task-checkbox').click()
    await page.locator('.sheet').getByRole('button', { name: 'אישור' }).click()

    const banner = page.locator('.stale-banner')
    await expect(banner).toBeVisible({ timeout: 15_000 })
    await expect(banner).toContainText('אין חיבור')
    // The list is still there - not replaced by a full-screen error.
    await expect(page.locator('.task-card', { hasText: 'לשטוף כלים' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'משהו השתבש' })).toHaveCount(0)

    db.failing = false
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await expect(banner).toHaveCount(0)
  })

  test('the banner\'s retry button refreshes on demand', async ({ page }) => {
    const db = makeFakeDb({ tasks: [dishes()] })
    await seed(page, db)
    await page.goto('/')
    await expect(page.locator('.task-card')).toBeVisible()

    db.failing = true
    await page.locator('.task-checkbox').click()
    await page.locator('.sheet').getByRole('button', { name: 'אישור' }).click()
    await expect(page.locator('.stale-banner')).toBeVisible({ timeout: 15_000 })

    db.failing = false
    await page.locator('.stale-banner').getByRole('button', { name: 'ניסיון נוסף' }).click()
    await expect(page.locator('.stale-banner')).toHaveCount(0)
  })

  test('a failed first load still shows the full error screen - there is nothing else to show', async ({ page }) => {
    const db = makeFakeDb({ tasks: [dishes()], failing: true })
    await seed(page, db)
    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'משהו השתבש' })).toBeVisible({ timeout: 15_000 })
  })
})

test.describe('timezone', () => {
  test('follows the device on load, without opening settings', async ({ page }) => {
    const db = makeFakeDb({ tasks: [dishes()] })
    db.profile.timezone = 'Europe/London'
    await seed(page, db)
    await page.goto('/')

    await expect(page.locator('.task-card')).toBeVisible()
    await expect.poll(() => db.profile.timezone).toBe('Asia/Jerusalem')
  })
})
