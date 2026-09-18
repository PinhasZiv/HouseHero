import { expect, test } from '@playwright/test'
import { FAKE_SPACE_ID, FAKE_USER_ID, installSupabaseMock, makeFakeDb, seedSession, type FakeDb, type FakeTask } from './support/mockSupabase'

// A personal reminder-time override, set from the task's own detail sheet:
// it must never touch the task row, only ever the signed-in person's own
// entry in task_reminder_overrides - see AppState/api.ts for the plumbing
// and supabase/functions/send-reminders for how delivery consults it.

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

function reminderTask(overrides: Partial<FakeTask> & { id: string; title: string }): FakeTask {
  return {
    space_id: FAKE_SPACE_ID,
    description: null,
    task_type: 'recurring',
    recurrence_mode: 'interval',
    interval_days: 1,
    weekly_days: null,
    end_condition: 'never',
    end_after_count: null,
    end_date: null,
    occurrences_completed: 0,
    points: 10,
    reminder_hour: 9,
    reminder_minute: 0,
    due_date: isoDaysFromToday(1),
    last_completed_date: null,
    last_completed_at: null,
    last_completed_by: null,
    last_completed_actor: null,
    is_done: false,
    assigned_to: null,
    created_by: FAKE_USER_ID,
    created_at: new Date().toISOString(),
    starts_at: null,
    expires_at: null,
    reminder_policy: null,
    cancelled_at: null,
    expired_at: null,
    ...overrides,
  }
}

test.describe('a personal reminder-time override', () => {
  test('setting one only changes what this person sees, not the task itself', async ({ page }) => {
    const db = makeFakeDb({
      tasks: [reminderTask({ id: 'task-trash', title: 'להוציא זבל', reminder_hour: 9, reminder_minute: 0 })],
    })
    await seed(page, db)
    await page.goto('/')
    await page.getByRole('button', { name: 'משימות' }).click()
    await page.locator('.task-card', { hasText: 'להוציא זבל' }).locator('.task-main').click()

    const history = page.locator('div.sheet', { hasText: 'להוציא זבל' })
    await expect(history).toBeVisible()
    await expect(history).toContainText('09:00')
    await expect(history).not.toContainText('רק לך')

    await history.getByRole('button', { name: 'שינוי שעת התזכורת שלי עבור להוציא זבל' }).click()

    const overrideSheet = page.locator('form.sheet', { hasText: 'שעת התזכורת שלי' })
    await expect(overrideSheet).toBeVisible()
    await overrideSheet.locator('input[type="time"]').fill('20:00')
    await overrideSheet.getByRole('button', { name: 'שמירה' }).click()

    await expect(overrideSheet).toBeHidden()
    await expect(history).toContainText('20:00 (רק לך)')

    // The task row itself never changed - only this person's own override.
    expect(db.tasks[0].reminder_hour).toBe(9)
    expect(db.tasks[0].reminder_minute).toBe(0)
    expect(db.reminderOverrides.get('task-trash')).toEqual({ hour: 20, minute: 0 })
  })

  test('a time-limited task on a daily cadence offers the same personal override', async ({ page }) => {
    const db = makeFakeDb({
      tasks: [
        reminderTask({
          id: 'task-window',
          title: 'להשקות את הגינה',
          task_type: 'time_limited',
          starts_at: new Date(Date.now() - 60 * 60_000).toISOString(),
          expires_at: new Date(Date.now() + 6 * 3600_000).toISOString(),
          reminder_policy: {
            mode: 'daily',
            intervalMinutes: null,
            intervalUnit: null,
            dailyIntervalDays: 1,
            dailyHour: 17,
            dailyMinute: 0,
            finalReminderMinutesBeforeExpiry: null,
          },
        }),
      ],
    })
    await seed(page, db)
    await page.goto('/')
    await page.getByRole('button', { name: 'משימות' }).click()
    await page.locator('.task-card', { hasText: 'להשקות את הגינה' }).locator('.task-main').click()

    const history = page.locator('div.sheet', { hasText: 'להשקות את הגינה' })
    await expect(history).toContainText('17:00')

    await history.getByRole('button', { name: 'שינוי שעת התזכורת שלי עבור להשקות את הגינה' }).click()
    const overrideSheet = page.locator('form.sheet', { hasText: 'שעת התזכורת שלי' })
    await overrideSheet.locator('input[type="time"]').fill('06:30')
    await overrideSheet.getByRole('button', { name: 'שמירה' }).click()

    await expect(overrideSheet).toBeHidden()
    await expect(history).toContainText('06:30 (רק לך)')
    expect(db.reminderOverrides.get('task-window')).toEqual({ hour: 6, minute: 30 })
  })

  test('does not offer a personal reminder time for a time-limited task on an interval cadence', async ({ page }) => {
    const db = makeFakeDb({
      tasks: [
        reminderTask({
          id: 'task-interval',
          title: 'לבדוק את התנור',
          task_type: 'time_limited',
          starts_at: new Date(Date.now() - 60 * 60_000).toISOString(),
          expires_at: new Date(Date.now() + 6 * 3600_000).toISOString(),
          reminder_policy: {
            mode: 'interval',
            intervalMinutes: 30,
            intervalUnit: 'minutes',
            dailyIntervalDays: null,
            dailyHour: null,
            dailyMinute: null,
            finalReminderMinutesBeforeExpiry: null,
          },
        }),
      ],
    })
    await seed(page, db)
    await page.goto('/')
    await page.getByRole('button', { name: 'משימות' }).click()
    await page.locator('.task-card', { hasText: 'לבדוק את התנור' }).locator('.task-main').click()

    const history = page.locator('div.sheet', { hasText: 'לבדוק את התנור' })
    await expect(history).toBeVisible()
    // start_only/interval are a fixed offset from the window's own opening
    // instant, the same for everyone - there is no time-of-day here to make
    // personal, so no reminder row (and no edit button) should appear at all.
    await expect(history.getByText('שעת תזכורת')).toHaveCount(0)
  })

  test('resetting it reverts to the task\'s own reminder time', async ({ page }) => {
    const db = makeFakeDb({
      tasks: [reminderTask({ id: 'task-dishes', title: 'לשטוף כלים', reminder_hour: 18, reminder_minute: 30 })],
      reminderOverrides: new Map([['task-dishes', { hour: 7, minute: 0 }]]),
    })
    await seed(page, db)
    await page.goto('/')
    await page.getByRole('button', { name: 'משימות' }).click()
    await page.locator('.task-card', { hasText: 'לשטוף כלים' }).locator('.task-main').click()

    const history = page.locator('div.sheet', { hasText: 'לשטוף כלים' })
    await expect(history).toContainText('07:00 (רק לך)')

    await history.getByRole('button', { name: 'שינוי שעת התזכורת שלי עבור לשטוף כלים' }).click()
    const overrideSheet = page.locator('form.sheet', { hasText: 'שעת התזכורת שלי' })
    await overrideSheet.getByRole('button', { name: 'איפוס לשעת ברירת המחדל' }).click()

    await expect(overrideSheet).toBeHidden()
    await expect(history).toContainText('18:30')
    await expect(history).not.toContainText('רק לך')
    expect(db.reminderOverrides.has('task-dishes')).toBe(false)
  })
})
