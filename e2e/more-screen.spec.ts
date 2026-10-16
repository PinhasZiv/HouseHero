import { expect, test, type Page } from '@playwright/test'
import { FAKE_SPACE_ID, FAKE_USER_ID, installSupabaseMock, makeFakeDb, seedSession, type FakeDb, type FakeTask } from './support/mockSupabase'

// More is a short list; each row opens its own screen, and back - the
// on-screen button or the phone's own - returns to the list.

async function seed(page: Page, db: FakeDb) {
  await seedSession(page)
  await page.addInitScript(() => window.localStorage.setItem('househero.language', 'he'))
  await installSupabaseMock(page, db)
}

test('More lists the space and the settings, each with what it is set to', async ({ page }) => {
  await seed(page, makeFakeDb())
  await page.goto('/?tab=more')

  await expect(page.getByRole('heading', { level: 1, name: 'עוד' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'המרחב והחברים' })).toContainText('הבית')
  await expect(page.getByRole('button', { name: 'חופשה' })).toContainText('כבויה')
  await expect(page.getByRole('button', { name: 'הזמנת אנשים' })).toContainText('ABC123')
  await expect(page.getByRole('button', { name: 'שפה' })).toContainText('עברית')
  await expect(page.getByRole('button', { name: 'חשבון' })).toContainText('test@example.com')
  await expect(page.getByRole('button', { name: 'התראות' })).toBeVisible()
  // None of the sections' own controls until one is opened.
  await expect(page.locator('.invite-code')).toHaveCount(0)
})

test('a row opens its own screen, and back returns to the list', async ({ page }) => {
  await seed(page, makeFakeDb())
  await page.goto('/?tab=more')

  await page.getByRole('button', { name: 'הזמנת אנשים' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'הזמנת אנשים' })).toBeVisible()
  await expect(page.locator('.invite-code')).toHaveText('ABC123')

  await page.getByRole('button', { name: 'חזרה' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'עוד' })).toBeVisible()

  // The phone's back does the same - and stays on More.
  await page.getByRole('button', { name: 'שפה' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'שפה' })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('heading', { level: 1, name: 'עוד' })).toBeVisible()
  await expect(page.locator('.tab-bar .tab-active')).toContainText('עוד')
})

test('the vacation row says when a vacation is on', async ({ page }) => {
  const db = makeFakeDb({ pauses: [{ id: 'p1', space_id: FAKE_SPACE_ID, user_id: FAKE_USER_ID, started_on: '2026-01-01', ended_on: null }] })
  await seed(page, db)
  await page.goto('/?tab=more')
  await expect(page.getByRole('button', { name: 'חופשה' })).toContainText('מופעלת')
})

function task(overrides: Partial<FakeTask> = {}): FakeTask {
  return {
    id: 'task-1', space_id: FAKE_SPACE_ID, title: 'להשקות עציצים', description: null,
    task_type: 'recurring', recurrence_mode: 'interval', interval_days: 3, weekly_days: null,
    end_condition: 'never', end_after_count: null, end_date: null, occurrences_completed: 0,
    points: 5, reminder_hour: 9, reminder_minute: 0, due_date: '2099-01-01',
    last_completed_date: null, last_completed_at: null, last_completed_by: null, last_completed_actor: null,
    is_done: false, assigned_to: null, created_by: FAKE_USER_ID, created_at: new Date().toISOString(),
    starts_at: null, expires_at: null, reminder_policy: null, cancelled_at: null, expired_at: null,
    ...overrides,
  }
}

test.describe('the task form', () => {
  test('keeps the description and the end condition folded away for a new task', async ({ page }) => {
    await seed(page, makeFakeDb())
    await page.goto('/?tab=tasks')
    await page.locator('.fab').click()

    const more = page.locator('.more-options')
    await expect(more).not.toHaveAttribute('open', '')
    await expect(page.getByText('תיאור (לא חובה)')).toBeHidden()

    await more.locator('summary').click()
    await expect(page.getByText('תיאור (לא חובה)')).toBeVisible()
    await expect(page.getByRole('group', { name: 'מתי לסיים' })).toBeVisible()
  })

  test('opens them when editing a task that uses them', async ({ page }) => {
    await seed(page, makeFakeDb({ tasks: [task({ description: 'גם במרפסת' })] }))
    await page.goto('/?tab=tasks')
    await page.getByRole('button', { name: 'עריכת להשקות עציצים' }).click()

    await expect(page.locator('.more-options')).toHaveAttribute('open', '')
    await expect(page.locator('textarea')).toHaveValue('גם במרפסת')
  })
})
