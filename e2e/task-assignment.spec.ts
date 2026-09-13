import { expect, test } from '@playwright/test'
import { FAKE_SPACE_ID, FAKE_USER_ID, installSupabaseMock, makeFakeDb, seedSession, type FakeDb } from './support/mockSupabase'

async function seed(page: import('@playwright/test').Page, db: FakeDb) {
  await seedSession(page)
  await page.addInitScript(() => window.localStorage.setItem('househero.language', 'he'))
  await installSupabaseMock(page, db)
}

// Assigning a task to a specific person should tell them right away - a
// separate, one-shot notification from the recurring due-date reminder they
// will still get later. Assigning to "everyone" (the default) never should.

test.describe('task assignment notifications', () => {
  test('creating a task assigned to someone else notifies them', async ({ page }) => {
    const db = makeFakeDb({
      otherPeople: [
        { id: 'other-user-id', display_name: 'Dana Cohen', avatar_url: null, email: 'dana@example.com', lifetime_points: 0, spendable_points: 0 },
      ],
    })
    await seed(page, db)
    await page.goto('/')
    await page.getByRole('button', { name: 'משימות' }).click()
    await page.getByRole('button', { name: 'הוספת המשימה הראשונה' }).click()

    await page.locator('#task-title').fill('לקפל כביסה')
    await page.getByLabel('שייכת ל').selectOption({ label: 'Dana Cohen' })
    await page.locator('.sheet').getByRole('button', { name: 'הוספת משימה' }).click()

    await expect(page.getByText('לקפל כביסה נוספה.')).toBeVisible()
    await expect.poll(() => db.assignmentNotifications).toHaveLength(1)
    expect(db.tasks.find((task) => task.id === db.assignmentNotifications[0].taskId)?.title).toBe('לקפל כביסה')
  })

  test('creating a task left assigned to everyone does not notify anyone', async ({ page }) => {
    const db = makeFakeDb({
      otherPeople: [
        { id: 'other-user-id', display_name: 'Dana Cohen', avatar_url: null, email: 'dana@example.com', lifetime_points: 0, spendable_points: 0 },
      ],
    })
    await seed(page, db)
    await page.goto('/')
    await page.getByRole('button', { name: 'משימות' }).click()
    await page.getByRole('button', { name: 'הוספת המשימה הראשונה' }).click()

    await page.locator('#task-title').fill('לנקות את המטבח')
    // Leaves the assignee selector at its default: everyone.
    await page.locator('.sheet').getByRole('button', { name: 'הוספת משימה' }).click()

    await expect(page.getByText('לנקות את המטבח נוספה.')).toBeVisible()
    expect(db.assignmentNotifications).toHaveLength(0)
  })

  test('editing a task to reassign it to someone else notifies them, but re-saving without changing it does not', async ({ page }) => {
    const db = makeFakeDb({
      tasks: [
        {
          id: 'task-vacuum',
          space_id: FAKE_SPACE_ID,
          title: 'לשאוב אבק',
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
          due_date: new Date().toISOString().slice(0, 10),
          last_completed_date: null,
          last_completed_by: null,
          last_completed_actor: null,
          is_done: false,
          assigned_to: null,
          created_by: FAKE_USER_ID,
          created_at: new Date().toISOString(),
        },
      ],
      otherPeople: [
        { id: 'other-user-id', display_name: 'Dana Cohen', avatar_url: null, email: 'dana@example.com', lifetime_points: 0, spendable_points: 0 },
      ],
    })
    await seed(page, db)
    await page.goto('/')
    await page.getByRole('button', { name: 'משימות' }).click()

    await page.locator('.task-card', { hasText: 'לשאוב אבק' }).getByRole('button', { name: 'עריכת לשאוב אבק' }).click()
    await page.getByLabel('שייכת ל').selectOption({ label: 'Dana Cohen' })
    await page.getByRole('button', { name: 'שמירה' }).click()

    await expect(page.locator('.sheet')).toHaveCount(0)
    await expect.poll(() => db.assignmentNotifications).toHaveLength(1)

    // Re-opening and saving again with the same assignee must not re-notify.
    await page.locator('.task-card', { hasText: 'לשאוב אבק' }).getByRole('button', { name: 'עריכת לשאוב אבק' }).click()
    await page.getByRole('button', { name: 'שמירה' }).click()
    await expect(page.locator('.sheet')).toHaveCount(0)
    expect(db.assignmentNotifications).toHaveLength(1)
  })
})
