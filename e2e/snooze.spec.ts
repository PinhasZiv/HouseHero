import { expect, test } from '@playwright/test'
import {
  FAKE_SPACE_ID,
  FAKE_USER_ID,
  installSupabaseMock,
  makeFakeDb,
  seedSession,
  type FakeDb,
} from './support/mockSupabase'

function isoDaysFromToday(offset: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

function baseTask(overrides: Partial<FakeDb['tasks'][number]>): FakeDb['tasks'][number] {
  return {
    id: 'task-x',
    space_id: FAKE_SPACE_ID,
    title: 'x',
    description: null,
    task_type: 'recurring',
    recurrence_mode: 'interval',
    interval_days: 7,
    weekly_days: null,
    end_condition: 'never',
    end_after_count: null,
    end_date: null,
    occurrences_completed: 0,
    points: 10,
    reminder_hour: 9,
    reminder_minute: 0,
    due_date: isoDaysFromToday(0),
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

async function seed(page: import('@playwright/test').Page, db: FakeDb) {
  await seedSession(page)
  await page.addInitScript(() => window.localStorage.setItem('househero.language', 'he'))
  await installSupabaseMock(page, db)
}

test.describe('snoozing a reminder', () => {
  test('snoozing a task moves it to Snoozed, and cancelling brings it back', async ({ page }) => {
    const db = makeFakeDb({
      tasks: [baseTask({ id: 'task-dishes', title: 'לשטוף כלים', due_date: isoDaysFromToday(-1) })],
    })
    await seed(page, db)

    await page.goto('/')

    const card = page.locator('.task-card', { hasText: 'לשטוף כלים' })
    await expect(card).toBeVisible()
    await expect(page.getByText('באיחור')).toBeVisible()

    await card.getByRole('button', { name: /השהיית התזכורת/ }).click()

    const sheet = page.locator('.sheet', { hasText: 'השהיית תזכורת' })
    await expect(sheet).toBeVisible()
    await expect(sheet.getByText('לשטוף כלים')).toBeVisible()

    await sheet.getByRole('button', { name: 'שעה', exact: true }).click()

    // The sheet closes, the task leaves the overdue list and lands in
    // "מושהה" instead, and the fake server actually received the snooze.
    await expect(sheet).toBeHidden()
    await expect(page.getByRole('heading', { name: 'מושהה' })).toBeVisible()
    const snoozedCard = page.locator('.task-card', { hasText: 'לשטוף כלים' })
    await expect(snoozedCard).toContainText('מושהה עד')
    expect(db.snoozes.get('task-dishes')).toBeTruthy()

    // Cancelling brings it straight back to the overdue list.
    await snoozedCard.getByRole('button', { name: /ביטול ההשהיה/ }).click()
    await expect(page.getByText('באיחור')).toBeVisible()
    await expect(page.locator('.task-card', { hasText: 'לשטוף כלים' })).not.toContainText('מושהה עד')
    expect(db.snoozes.has('task-dishes')).toBe(false)
  })

  test("a notification's Snooze action opens the picker for everything due", async ({ page }) => {
    const db = makeFakeDb({
      tasks: [baseTask({ id: 'task-trash', title: 'להוציא זבל', due_date: isoDaysFromToday(0) })],
    })
    await seed(page, db)

    // The service worker's Snooze action opens the app with this query flag -
    // simulated here directly, since driving an actual push event needs a
    // real service worker lifecycle Playwright cannot trigger.
    await page.goto('/?snooze=1')

    const sheet = page.locator('.sheet', { hasText: 'השהיית תזכורת' })
    await expect(sheet).toBeVisible()
    await expect(sheet.getByText('להוציא זבל')).toBeVisible()

    // The flag is consumed - the query string is gone, so a later reload
    // will not reopen the sheet on its own.
    expect(new URL(page.url()).search).toBe('')
  })
})
