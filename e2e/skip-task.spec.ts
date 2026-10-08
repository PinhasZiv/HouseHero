import { expect, test } from '@playwright/test'
import { FAKE_SPACE_ID, FAKE_USER_ID, installSupabaseMock, makeFakeDb, seedSession, type FakeDb } from './support/mockSupabase'

// Skipping one occurrence of a recurring task - "not needed this time", the
// dishwasher example. Settles the day without counting as late and without
// touching points, crediting, or task_completions at all.

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

function recurringTask(overrides: { id: string; title: string; dueDate: string }) {
  return {
    id: overrides.id,
    space_id: FAKE_SPACE_ID,
    title: overrides.title,
    description: null,
    task_type: 'recurring' as const,
    recurrence_mode: 'interval' as const,
    interval_days: 1,
    weekly_days: null,
    end_condition: 'never' as const,
    end_after_count: null,
    end_date: null,
    occurrences_completed: 0,
    points: 10,
    reminder_hour: 9,
    reminder_minute: 0,
    due_date: overrides.dueDate,
    last_completed_date: null,
    last_completed_at: null,
    last_completed_by: null,
    last_completed_actor: null,
    last_skipped_date: null,
    last_skipped_by: null,
    is_done: false,
    assigned_to: null,
    created_by: FAKE_USER_ID,
    created_at: new Date().toISOString(),
    starts_at: null,
    expires_at: null,
    reminder_policy: null,
    cancelled_at: null,
    expired_at: null,
  }
}

function oneTimeTask(overrides: { id: string; title: string; dueDate: string }) {
  return { ...recurringTask(overrides), task_type: 'one_time' as const, recurrence_mode: null, interval_days: null }
}

test.describe('skipping a recurring task occurrence', () => {
  test('tapping the skip button settles the task for the day, advances its schedule, and offers Undo', async ({ page }) => {
    const db = makeFakeDb({
      tasks: [recurringTask({ id: 'task-1', title: 'להכניס מדיח', dueDate: isoDaysFromToday(0) })],
    })
    await seed(page, db)
    await page.goto('/')

    const card = page.locator('.task-card', { hasText: 'להכניס מדיח' })
    await expect(card).toBeVisible()
    await card.getByRole('button', { name: /דילוג על .* הפעם/ }).click()

    await expect(page.locator('.toast')).toContainText('דילגת על להכניס מדיח הפעם')

    // Settled for the day - out of the due list, inside the done section,
    // with its own label rather than a completion.
    await expect(page.locator('.task-group:not(.completed-group)', { hasText: 'להכניס מדיח' })).toHaveCount(0)
    const doneSection = page.locator('.completed-group', { hasText: 'בוצעו היום' })
    await doneSection.locator('summary').click()
    const doneCard = page.locator('.task-card', { hasText: 'להכניס מדיח' })
    await expect(doneCard).toContainText('דולגה הפעם')
    // Still unchecked - a skip is not a completion, so it stays tappable.
    await expect(doneCard.locator('.task-checkbox')).not.toHaveClass(/task-checkbox-checked/)

    // The server actually recorded the skip and advanced the schedule to
    // the real next occurrence, without touching points or a completion row.
    expect(db.tasks[0].due_date).toBe(isoDaysFromToday(1))
    expect(db.tasks[0].last_skipped_date).toBe(isoDaysFromToday(0))
    expect(db.tasks[0].is_done).toBe(false)
    expect(db.taskSkips).toHaveLength(1)
    expect(db.taskCompletions).toHaveLength(0)
    expect(db.profile.lifetime_points).toBe(0)
  })

  test('the toast\'s Undo action restores the task to exactly where it was', async ({ page }) => {
    const db = makeFakeDb({
      tasks: [recurringTask({ id: 'task-1', title: 'להכניס מדיח', dueDate: isoDaysFromToday(0) })],
    })
    await seed(page, db)
    await page.goto('/')

    const card = page.locator('.task-card', { hasText: 'להכניס מדיח' })
    await card.getByRole('button', { name: /דילוג על .* הפעם/ }).click()
    await expect(page.locator('.toast')).toBeVisible()

    await page.locator('.toast-action').click()

    // Back in the due list, not the done section, with its original due date.
    await expect(page.locator('.completed-group')).toHaveCount(0)
    await expect(page.locator('.task-card', { hasText: 'להכניס מדיח' })).toBeVisible()
    expect(db.tasks[0].due_date).toBe(isoDaysFromToday(0))
    expect(db.tasks[0].last_skipped_date).toBeNull()
    expect(db.taskSkips).toHaveLength(0)
  })

  test('a one-time task never offers a skip button - there is no later occurrence to defer to', async ({ page }) => {
    const db = makeFakeDb({
      tasks: [oneTimeTask({ id: 'task-1', title: 'להרכיב מדף', dueDate: isoDaysFromToday(0) })],
    })
    await seed(page, db)
    await page.goto('/')

    const card = page.locator('.task-card', { hasText: 'להרכיב מדף' })
    await expect(card).toBeVisible()
    await expect(card.getByRole('button', { name: /דילוג על/ })).toHaveCount(0)
  })

  test('a skip shows up in the task history as its own entry, distinct from a completion', async ({ page }) => {
    const db = makeFakeDb({
      tasks: [recurringTask({ id: 'task-1', title: 'להכניס מדיח', dueDate: isoDaysFromToday(0) })],
    })
    await seed(page, db)
    await page.goto('/')

    const card = page.locator('.task-card', { hasText: 'להכניס מדיח' })
    await card.getByRole('button', { name: /דילוג על .* הפעם/ }).click()
    await expect(page.locator('.toast')).toBeVisible()

    const doneSection = page.locator('.completed-group', { hasText: 'בוצעו היום' })
    await doneSection.locator('summary').click()
    await page.locator('.task-main', { hasText: 'להכניס מדיח' }).click()

    await expect(page.locator('.sheet').getByRole('heading', { name: 'להכניס מדיח' })).toBeVisible()
    const historyRow = page.locator('.history-row', { hasText: 'דולגה הפעם' })
    await expect(historyRow).toBeVisible()
    await expect(historyRow).toHaveClass(/history-row-muted/)
  })
})
