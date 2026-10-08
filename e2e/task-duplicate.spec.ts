import { expect, test } from '@playwright/test'
import { FAKE_SPACE_ID, FAKE_USER_ID, installSupabaseMock, makeFakeDb, seedSession, type FakeDb } from './support/mockSupabase'

// Duplicating works for every task type from the edit form - the shortcut for
// a task that has to happen more than once a day (morning and evening ear
// drops): two independent recurring tasks, created without retyping one.

function isoDaysFromToday(offset: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

/** "Today" as the app itself sees it - the fake profile's own timezone. */
function appToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date())
}

async function seed(page: import('@playwright/test').Page, db: FakeDb) {
  await seedSession(page)
  await page.addInitScript(() => window.localStorage.setItem('househero.language', 'he'))
  await installSupabaseMock(page, db)
}

function task(overrides: Partial<FakeDb['tasks'][number]> & { id: string; title: string }) {
  return {
    space_id: FAKE_SPACE_ID,
    description: null,
    task_type: 'recurring' as const,
    recurrence_mode: 'interval' as const,
    interval_days: 1,
    weekly_days: null,
    end_condition: 'never' as const,
    end_after_count: null,
    end_date: null,
    occurrences_completed: 0,
    points: 5,
    reminder_hour: 8,
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

test.describe('duplicating a task', () => {
  test('a recurring task can be duplicated from its edit form into an independent second task', async ({ page }) => {
    const endDate = isoDaysFromToday(14)
    const db = makeFakeDb({
      tasks: [
        task({
          id: 'task-morning',
          title: 'טיפות אוזניים בוקר',
          end_condition: 'on_date',
          end_date: endDate,
          points: 7,
          occurrences_completed: 2,
          // Overdue - the copy must not inherit that and start out late.
          due_date: isoDaysFromToday(-3),
        }),
      ],
    })
    await seed(page, db)
    await page.goto('/')
    await page.getByRole('button', { name: 'משימות' }).click()
    await page
      .locator('.task-card', { hasText: 'טיפות אוזניים בוקר' })
      .getByRole('button', { name: 'עריכת טיפות אוזניים בוקר' })
      .click()

    await page.getByRole('button', { name: 'שכפול המשימה' }).click()

    // The edit form is replaced by a new-task form pre-filled from the original.
    await expect(page.getByRole('heading', { name: 'משימה חדשה' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'עריכת משימה' })).toHaveCount(0)
    await expect(page.locator('#task-title')).toHaveValue('טיפות אוזניים בוקר')

    await page.locator('#task-title').fill('טיפות אוזניים ערב')
    await page.getByLabel('שעת התזכורת של המשימה').fill('20:00')
    await page.locator('.sheet').getByRole('button', { name: 'הוספת משימה' }).click()

    await expect(page.locator('.task-card', { hasText: 'טיפות אוזניים ערב' })).toBeVisible()
    expect(db.tasks).toHaveLength(2)

    const original = db.tasks.find((t) => t.id === 'task-morning')!
    expect(original.title).toBe('טיפות אוזניים בוקר')
    expect(original.reminder_hour).toBe(8)
    expect(original.occurrences_completed).toBe(2)

    const copy = db.tasks.find((t) => t.id !== 'task-morning')!
    expect(copy.title).toBe('טיפות אוזניים ערב')
    expect(copy.reminder_hour).toBe(20)
    expect(copy.task_type).toBe('recurring')
    expect(copy.interval_days).toBe(1)
    expect(copy.end_condition).toBe('on_date')
    expect(copy.end_date).toBe(endDate)
    expect(copy.points).toBe(7)
    expect(copy.occurrences_completed).toBe(0)
    expect(copy.due_date).toBe(appToday())
  })

  test('a finished one-time task can be duplicated too, and the copy starts open', async ({ page }) => {
    const db = makeFakeDb({
      tasks: [
        task({
          id: 'task-once',
          title: 'להחליף פילטר במזגן',
          task_type: 'one_time',
          recurrence_mode: null,
          interval_days: null,
          due_date: isoDaysFromToday(-10),
          is_done: true,
          last_completed_date: isoDaysFromToday(-10),
          last_completed_at: new Date(Date.now() - 10 * 86_400_000).toISOString(),
          last_completed_by: [FAKE_USER_ID],
          last_completed_actor: FAKE_USER_ID,
          occurrences_completed: 1,
        }),
      ],
    })
    await seed(page, db)
    await page.goto('/')
    await page.getByRole('button', { name: 'משימות' }).click()
    await page.locator('.completed-group summary').click()
    await page
      .locator('.completed-group .task-card', { hasText: 'להחליף פילטר במזגן' })
      .getByRole('button', { name: 'עריכת להחליף פילטר במזגן' })
      .click()

    await page.getByRole('button', { name: 'שכפול המשימה' }).click()
    await expect(page.getByRole('heading', { name: 'משימה חדשה' })).toBeVisible()
    await page.locator('.sheet').getByRole('button', { name: 'הוספת משימה' }).click()

    await expect.poll(() => db.tasks.length).toBe(2)
    const original = db.tasks.find((t) => t.id === 'task-once')!
    expect(original.is_done).toBe(true)
    const copy = db.tasks.find((t) => t.id !== 'task-once')!
    expect(copy.title).toBe('להחליף פילטר במזגן')
    expect(copy.task_type).toBe('one_time')
    expect(copy.is_done).toBe(false)
    expect(copy.due_date).toBe(appToday())
  })

  test('the new-task form does not offer duplicating - only editing an existing task does', async ({ page }) => {
    const db = makeFakeDb({ tasks: [task({ id: 'task-1', title: 'להשקות עציצים' })] })
    await seed(page, db)
    await page.goto('/')
    await page.getByRole('button', { name: 'משימות' }).click()
    await page.getByRole('button', { name: 'הוספת משימה' }).click()

    await expect(page.getByRole('heading', { name: 'משימה חדשה' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'שכפול המשימה' })).toHaveCount(0)
  })
})
