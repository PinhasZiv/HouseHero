import { expect, test } from '@playwright/test'
import { FAKE_SPACE_ID, FAKE_USER_ID, installSupabaseMock, makeFakeDb, seedSession } from './support/mockSupabase'

async function seed(page: import('@playwright/test').Page, db: ReturnType<typeof makeFakeDb>) {
  await seedSession(page)
  await page.addInitScript(() => window.localStorage.setItem('househero.language', 'he'))
  await installSupabaseMock(page, db)
}

// Leaving or deleting a space used to go through the browser's own
// window.confirm() - jarring next to the rest of the app's custom sheets,
// and impossible to style or to report an error from. These exercise the
// ConfirmSheet that replaced it.

test.describe('leaving or deleting a space', () => {
  test('cancelling the confirm sheet leaves the space untouched', async ({ page }) => {
    const db = makeFakeDb({})
    await seed(page, db)
    await page.goto('/')
    await page.getByRole('button', { name: 'עוד' }).click()

    await page.getByRole('button', { name: 'יציאה מהמרחב' }).click()
    const sheet = page.locator('.sheet', { hasText: 'יציאה מהמרחב' })
    await expect(sheet).toBeVisible()
    await sheet.getByRole('button', { name: 'ביטול' }).click()
    await expect(sheet).toBeHidden()

    expect(db.spaces).toHaveLength(1)
  })

  test('confirming leave sends leave_space and returns to onboarding once no space is left', async ({ page }) => {
    const db = makeFakeDb({})
    await seed(page, db)
    await page.goto('/')
    await page.getByRole('button', { name: 'עוד' }).click()

    await page.getByRole('button', { name: 'יציאה מהמרחב' }).click()
    await page.locator('.sheet').getByRole('button', { name: 'יציאה מהמרחב' }).click()

    await expect(page.getByText('יצאת מהמרחב.')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'עוד רגע מסיימים' })).toBeVisible()
    expect(db.spaces).toHaveLength(0)
  })

  test('confirming "delete for everyone" removes the space for good', async ({ page }) => {
    const db = makeFakeDb({})
    await seed(page, db)
    await page.goto('/')
    await page.getByRole('button', { name: 'עוד' }).click()

    await page.getByRole('button', { name: 'מחיקת המרחב לכולם' }).click()
    const sheet = page.locator('.sheet', { hasText: 'מחיקת המרחב לכולם' })
    await expect(sheet).toBeVisible()
    await sheet.getByRole('button', { name: 'מחיקת המרחב לכולם' }).click()

    await expect(page.getByText('המרחב נמחק.')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'עוד רגע מסיימים' })).toBeVisible()
    expect(db.spaces).toHaveLength(0)
  })
})

const DANA = { id: '33333333-3333-4333-8333-333333333333', display_name: 'דנה כהן', avatar_url: null, email: 'dana@example.com', lifetime_points: 0, spendable_points: 0 }

test.describe('managing a space as its owner', () => {
  test('creating a new invite code replaces the old one', async ({ page }) => {
    const db = makeFakeDb({})
    await seed(page, db)
    await page.goto('/')
    await page.getByRole('button', { name: 'עוד' }).click()
    await expect(page.locator('.invite-code')).toHaveText('ABC123')

    await page.getByRole('button', { name: 'יצירת קוד חדש' }).click()
    await page.locator('.sheet').getByRole('button', { name: 'יצירת קוד חדש' }).click()

    await expect(page.locator('.invite-code')).not.toHaveText('ABC123')
    const newCode = db.spaces[0].invite_code
    expect(newCode).not.toBe('ABC123')
    await expect(page.locator('.invite-code')).toHaveText(newCode)
    await expect(page.getByText(`הקוד החדש: ${newCode}`)).toBeVisible()
  })

  test('removing a member takes them out of the list and unassigns their tasks', async ({ page }) => {
    const db = makeFakeDb({
      otherPeople: [DANA],
      tasks: [
        {
          id: 'task-1', space_id: FAKE_SPACE_ID, title: 'להשקות עציצים', description: null,
          task_type: 'recurring', recurrence_mode: 'interval', interval_days: 3, weekly_days: null,
          end_condition: 'never', end_after_count: null, end_date: null, occurrences_completed: 0,
          points: 5, reminder_hour: 9, reminder_minute: 0, due_date: '2099-01-01',
          last_completed_date: null, last_completed_at: null, last_completed_by: null, last_completed_actor: null,
          is_done: false, assigned_to: DANA.id, created_by: FAKE_USER_ID, created_at: new Date().toISOString(),
          starts_at: null, expires_at: null, reminder_policy: null, cancelled_at: null, expired_at: null,
        },
      ],
    })
    await seed(page, db)
    await page.goto('/')
    await page.getByRole('button', { name: 'עוד' }).click()
    await expect(page.locator('.member-list li')).toHaveCount(2)

    await page.getByRole('button', { name: 'הסרת דנה כהן מהמרחב' }).click()
    await page.locator('.sheet').getByRole('button', { name: 'הסרה' }).click()

    await expect(page.getByText('דנה כהן הוסר/ה מהמרחב.')).toBeVisible()
    await expect(page.locator('.member-list li')).toHaveCount(1)
    expect(db.otherPeople).toHaveLength(0)
    expect(db.tasks[0].assigned_to).toBeNull()
  })

  test('a regular member sees neither the new-code nor the remove buttons', async ({ page }) => {
    const db = makeFakeDb({ otherPeople: [DANA], selfRole: 'member' })
    await seed(page, db)
    await page.goto('/')
    await page.getByRole('button', { name: 'עוד' }).click()
    await expect(page.locator('.member-list li')).toHaveCount(2)

    await expect(page.getByRole('button', { name: 'יצירת קוד חדש' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^הסרת .* מהמרחב$/ })).toHaveCount(0)
  })
})
