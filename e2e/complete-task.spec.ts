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

test.describe('completing a task', () => {
  test('awards its points and moves it into the completed group', async ({ page }) => {
    const db = makeFakeDb({
      tasks: [
        {
          id: 'task-once',
          space_id: FAKE_SPACE_ID,
          title: 'להרכיב את הארון',
          description: null,
          task_type: 'one_time',
          recurrence_mode: null,
          interval_days: null,
          weekly_days: null,
          end_condition: 'never',
          end_after_count: null,
          end_date: null,
          occurrences_completed: 0,
          points: 25,
          reminder_hour: 9,
          reminder_minute: 0,
          due_date: isoDaysFromToday(0),
          last_completed_date: null,
          last_completed_by: null,
          is_done: false,
          assigned_to: null,
          created_by: FAKE_USER_ID,
          created_at: new Date().toISOString(),
        },
      ],
    })
    await seed(page, db)
    await page.goto('/')

    const card = page.locator('.task-card', { hasText: 'להרכיב את הארון' })
    await expect(card).toBeVisible()
    await expect(page.getByText('להיום')).toBeVisible()

    await card.getByRole('button', { name: /סימון .* כבוצעה/ }).click()

    // A toast confirms the points, and the task now sits in "בוצעו היום"
    // rather than the due list.
    await expect(page.getByText('+25 נקודות', { exact: false })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'בוצעו היום' })).toBeVisible()
    await expect(page.locator('.task-card', { hasText: 'להרכיב את הארון' })).toContainText('בוצעה על ידך')

    // The server actually recorded the completion and the points.
    expect(db.tasks[0].is_done).toBe(true)
    expect(db.profile.lifetime_points).toBe(25)
    expect(db.profile.spendable_points).toBe(25)

    // The same points show up from the Rewards screen too - one profile, not
    // a number that only the Today screen knows about.
    await page.getByRole('button', { name: 'תגמולים' }).click()
    await expect(page.locator('.points-value').first()).toHaveText('25')
  })
})
