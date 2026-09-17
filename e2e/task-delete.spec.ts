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

// Deleting a task used to go through window.confirm() - replaced with the
// same ConfirmSheet the space screen now uses, for a consistent style and so
// a failed delete has somewhere to show an error other than a second alert().

test.describe('deleting a task', () => {
  test('cancelling the confirm sheet leaves the task in place', async ({ page }) => {
    const db = makeFakeDb({
      tasks: [
        {
          id: 'task-dishes', space_id: FAKE_SPACE_ID, title: 'לשטוף כלים', description: null,
          task_type: 'recurring', recurrence_mode: 'interval', interval_days: 3, weekly_days: null,
          end_condition: 'never', end_after_count: null, end_date: null, occurrences_completed: 0,
          points: 5, reminder_hour: 9, reminder_minute: 0, due_date: isoDaysFromToday(1),
          last_completed_date: null, last_completed_at: null, last_completed_by: null, last_completed_actor: null,
          is_done: false, assigned_to: null, created_by: FAKE_USER_ID, created_at: new Date().toISOString(),
          starts_at: null, expires_at: null, reminder_policy: null, cancelled_at: null, expired_at: null,
        },
      ],
    })
    await seed(page, db)
    await page.goto('/')
    await page.getByRole('button', { name: 'משימות' }).click()
    await page.locator('.task-card', { hasText: 'לשטוף כלים' }).getByRole('button', { name: 'עריכת לשטוף כלים' }).click()

    await page.getByRole('button', { name: 'מחיקת המשימה' }).click()
    const sheet = page.locator('div.sheet', { hasText: 'מחיקת המשימה' })
    await expect(sheet).toBeVisible()
    await sheet.getByRole('button', { name: 'ביטול' }).click()
    await expect(sheet).toBeHidden()

    expect(db.tasks).toHaveLength(1)
  })

  test('confirming delete removes the task', async ({ page }) => {
    const db = makeFakeDb({
      tasks: [
        {
          id: 'task-dishes', space_id: FAKE_SPACE_ID, title: 'לשטוף כלים', description: null,
          task_type: 'recurring', recurrence_mode: 'interval', interval_days: 3, weekly_days: null,
          end_condition: 'never', end_after_count: null, end_date: null, occurrences_completed: 0,
          points: 5, reminder_hour: 9, reminder_minute: 0, due_date: isoDaysFromToday(1),
          last_completed_date: null, last_completed_at: null, last_completed_by: null, last_completed_actor: null,
          is_done: false, assigned_to: null, created_by: FAKE_USER_ID, created_at: new Date().toISOString(),
          starts_at: null, expires_at: null, reminder_policy: null, cancelled_at: null, expired_at: null,
        },
      ],
    })
    await seed(page, db)
    await page.goto('/')
    await page.getByRole('button', { name: 'משימות' }).click()
    await page.locator('.task-card', { hasText: 'לשטוף כלים' }).getByRole('button', { name: 'עריכת לשטוף כלים' }).click()

    await page.getByRole('button', { name: 'מחיקת המשימה' }).click()
    await page.locator('div.sheet', { hasText: 'מחיקת המשימה' }).getByRole('button', { name: 'מחיקת המשימה' }).click()

    await expect(page.getByText('המשימה נמחקה.')).toBeVisible()
    expect(db.tasks).toHaveLength(0)
  })
})
