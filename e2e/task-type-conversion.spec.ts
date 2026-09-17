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

// A recurring task's own completion never sets is_done - it just advances
// due_date to the next occurrence, since the task keeps going. Converting
// that task to one_time (or time_limited) part-way through its life used to
// leave that stale, already-past due_date in place with is_done still
// false, so the "new" one-time task reopened itself the moment that date
// arrived - even though, from a one-time task's perspective, its one and
// only completion already happened under the recurring identity.

test.describe('converting a completed recurring task to one-time', () => {
  test('does not resurrect it once its carried-over due date arrives', async ({ page }) => {
    const db = makeFakeDb({
      tasks: [
        {
          id: 'task-airtag', space_id: FAKE_SPACE_ID, title: 'לאסוף AirTag', description: null,
          task_type: 'recurring', recurrence_mode: 'interval', interval_days: 1, weekly_days: null,
          end_condition: 'never', end_after_count: null, end_date: null,
          // Already completed once as recurring - due_date already advanced
          // to today by that completion, exactly the scenario that resurfaced it.
          occurrences_completed: 1,
          points: 5, reminder_hour: 9, reminder_minute: 0, due_date: isoDaysFromToday(0),
          last_completed_date: isoDaysFromToday(-1), last_completed_at: new Date(Date.now() - 86_400_000).toISOString(),
          last_completed_by: [FAKE_USER_ID], last_completed_actor: FAKE_USER_ID,
          is_done: false, assigned_to: null, created_by: FAKE_USER_ID, created_at: new Date().toISOString(),
          starts_at: null, expires_at: null, reminder_policy: null, cancelled_at: null, expired_at: null,
        },
      ],
    })
    await seed(page, db)
    await page.goto('/')
    await page.getByRole('button', { name: 'משימות' }).click()

    // It's still open (recurring, due today) before the edit.
    await expect(page.locator('.task-card', { hasText: 'לאסוף AirTag' })).toBeVisible()

    await page.locator('.task-card', { hasText: 'לאסוף AirTag' }).getByRole('button', { name: 'עריכת לאסוף AirTag' }).click()
    await page.getByRole('button', { name: 'חד-פעמית' }).click()
    await page.locator('.sheet').getByRole('button', { name: 'שמירה' }).click()

    expect(db.tasks[0].is_done).toBe(true)
    // Moved into the completed section, not still asking to be done again.
    await expect(page.locator('.completed-group')).toBeVisible()
    await page.locator('.completed-group summary').click()
    await expect(page.locator('.completed-group .task-card', { hasText: 'לאסוף AirTag' })).toBeVisible()
  })

  test('a never-completed recurring task stays open (late) after the same conversion', async ({ page }) => {
    const db = makeFakeDb({
      tasks: [
        {
          id: 'task-dishes', space_id: FAKE_SPACE_ID, title: 'לשטוף כלים', description: null,
          task_type: 'recurring', recurrence_mode: 'interval', interval_days: 3, weekly_days: null,
          end_condition: 'never', end_after_count: null, end_date: null,
          // Never completed - genuinely overdue, and should stay that way.
          occurrences_completed: 0,
          points: 5, reminder_hour: 9, reminder_minute: 0, due_date: isoDaysFromToday(-2),
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
    await page.getByRole('button', { name: 'חד-פעמית' }).click()
    await page.locator('.sheet').getByRole('button', { name: 'שמירה' }).click()

    expect(db.tasks[0].is_done).toBe(false)
    await expect(page.locator('.task-card', { hasText: 'לשטוף כלים' })).toBeVisible()
    await expect(page.locator('.completed-group')).toHaveCount(0)
  })
})
