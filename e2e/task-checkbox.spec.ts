import { expect, test } from '@playwright/test'
import { FAKE_SPACE_ID, FAKE_USER_ID, installSupabaseMock, makeFakeDb, seedSession, type FakeDb } from './support/mockSupabase'

// The done/not-done toggle lives on a single leading checkbox now (complete
// and undo share it) rather than a pair of wide trailing buttons - these
// cover the checkbox's own states, since complete-task.spec.ts already
// covers the completion flow it opens.

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

function baseTask(overrides: Partial<{
  id: string
  title: string
  due_date: string
  is_done: boolean
  last_completed_date: string | null
  last_completed_actor: string | null
}>) {
  return {
    id: overrides.id!,
    space_id: FAKE_SPACE_ID,
    title: overrides.title!,
    description: null,
    task_type: 'recurring' as const,
    recurrence_mode: 'interval' as const,
    interval_days: 1,
    weekly_days: null,
    end_condition: 'never' as const,
    end_after_count: null,
    end_date: null,
    occurrences_completed: overrides.last_completed_date ? 1 : 0,
    points: 10,
    reminder_hour: 9,
    reminder_minute: 0,
    due_date: overrides.due_date!,
    last_completed_date: overrides.last_completed_date ?? null,
    last_completed_at: overrides.last_completed_date ? new Date().toISOString() : null,
    last_completed_by: overrides.last_completed_date ? [FAKE_USER_ID] : null,
    last_completed_actor: overrides.last_completed_actor ?? null,
    is_done: overrides.is_done ?? false,
    assigned_to: null,
    created_by: FAKE_USER_ID,
    created_at: new Date().toISOString(),
  }
}

test.describe('the task checkbox', () => {
  test('an open task shows an unchecked checkbox that opens the completion picker', async ({ page }) => {
    const db = makeFakeDb({ tasks: [baseTask({ id: 'task-1', title: 'לנקות חלונות', due_date: isoDaysFromToday(0) })] })
    await seed(page, db)
    await page.goto('/')

    const checkbox = page.locator('.task-checkbox')
    await expect(checkbox).not.toHaveClass(/task-checkbox-checked/)
    await checkbox.click()
    await expect(page.getByRole('heading', { name: 'מי ביצע את זה?' })).toBeVisible()
  })

  test('tapping the checkbox again on a task completed today undoes it', async ({ page }) => {
    const db = makeFakeDb({
      tasks: [
        baseTask({
          id: 'task-1',
          title: 'לנקות חלונות',
          due_date: isoDaysFromToday(1),
          last_completed_date: isoDaysFromToday(0),
          last_completed_actor: FAKE_USER_ID,
        }),
      ],
      // The undo mock reverses the most recent completion *event* - a task
      // seeded as already-done needs one on record, the same as a real
      // completion would have left behind.
      taskCompletions: [
        {
          id: 'completion-1',
          task_id: 'task-1',
          user_id: FAKE_USER_ID,
          points_awarded: 10,
          completed_on: isoDaysFromToday(0),
          created_at: new Date().toISOString(),
          completion_group: null,
        },
      ],
    })
    await seed(page, db)
    await page.goto('/')

    const checkbox = page.locator('.completed-group .task-checkbox')
    await page.locator('.completed-group summary').click()
    await expect(checkbox).toHaveClass(/task-checkbox-checked/)
    await expect(checkbox).toBeEnabled()

    await checkbox.click()
    await expect(page.locator('.completed-group')).toHaveCount(0)
    expect(db.tasks[0].is_done).toBe(false)
    expect(db.tasks[0].last_completed_date).toBeNull()
  })

  test('a task completed on an earlier day shows a checked but disabled checkbox', async ({ page }) => {
    const db = makeFakeDb({
      tasks: [
        baseTask({
          id: 'task-1',
          title: 'משימה שהושלמה מזמן',
          due_date: isoDaysFromToday(-10),
          is_done: true,
          last_completed_date: isoDaysFromToday(-9),
          last_completed_actor: FAKE_USER_ID,
        }),
      ],
    })
    await seed(page, db)
    await page.goto('/')
    await page.getByRole('button', { name: 'משימות' }).click()
    await page.locator('.completed-group summary').click()

    const checkbox = page.locator('.task-checkbox')
    await expect(checkbox).toHaveClass(/task-checkbox-checked/)
    await expect(checkbox).toBeDisabled()
  })
})
