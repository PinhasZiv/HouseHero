import { expect, test } from '@playwright/test'
import { FAKE_SPACE_ID, FAKE_USER_ID, installSupabaseMock, makeFakeDb, seedSession, type FakeDb } from './support/mockSupabase'

// Back (Android's button, a browser's) used to always leave the app - the app
// never put anything in the session history. Now it closes the topmost sheet,
// then returns to Today, and only then leaves.

async function seed(page: import('@playwright/test').Page, db: FakeDb) {
  await seedSession(page)
  await page.addInitScript(() => window.localStorage.setItem('househero.language', 'he'))
  await installSupabaseMock(page, db)
}

function dishesDb() {
  return makeFakeDb({
    tasks: [
      {
        id: 'task-dishes', space_id: FAKE_SPACE_ID, title: 'לשטוף כלים', description: null,
        task_type: 'recurring', recurrence_mode: 'interval', interval_days: 3, weekly_days: null,
        end_condition: 'never', end_after_count: null, end_date: null, occurrences_completed: 0,
        points: 5, reminder_hour: 9, reminder_minute: 0, due_date: '2099-01-01',
        last_completed_date: null, last_completed_at: null, last_completed_by: null, last_completed_actor: null,
        is_done: false, assigned_to: null, created_by: FAKE_USER_ID, created_at: new Date().toISOString(),
        starts_at: null, expires_at: null, reminder_policy: null, cancelled_at: null, expired_at: null,
      },
    ],
  })
}

async function openEditForm(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'משימות' }).click()
  await page.getByRole('button', { name: 'עריכת לשטוף כלים' }).click()
  const form = page.getByRole('dialog', { name: 'עריכת משימה' })
  await expect(form).toBeVisible()
  return form
}

test.describe('the back button', () => {
  test('closes an open sheet instead of leaving the app', async ({ page }) => {
    await seed(page, dishesDb())
    await page.goto('/')
    const form = await openEditForm(page)

    await page.goBack()
    await expect(form).toHaveCount(0)
    // Still in the app, still on the Tasks tab.
    await expect(page.getByRole('button', { name: 'משימות' })).toHaveAttribute('aria-current', 'page')
  })

  test('closes stacked sheets one at a time, topmost first', async ({ page }) => {
    await seed(page, dishesDb())
    await page.goto('/')
    const form = await openEditForm(page)
    await form.getByRole('button', { name: 'מחיקת המשימה' }).click()
    const confirm = page.getByRole('dialog', { name: 'מחיקת המשימה' })
    await expect(confirm).toBeVisible()

    await page.goBack()
    await expect(confirm).toHaveCount(0)
    await expect(form).toBeVisible()

    await page.goBack()
    await expect(form).toHaveCount(0)
  })

  test('returns from another tab to Today, and only then leaves the app', async ({ page }) => {
    await seed(page, dishesDb())
    await page.goto('about:blank')
    await page.goto('/')
    await page.getByRole('button', { name: 'סטטיסטיקות' }).click()
    await expect(page.getByRole('button', { name: 'סטטיסטיקות' })).toHaveAttribute('aria-current', 'page')

    await page.goBack()
    await expect(page.getByRole('button', { name: 'היום' })).toHaveAttribute('aria-current', 'page')

    await page.goBack()
    await expect(page).toHaveURL('about:blank')
  })

  test('after duplicating (one form closes as another opens), back closes the new form', async ({ page }) => {
    await seed(page, dishesDb())
    await page.goto('/')
    const form = await openEditForm(page)
    await form.getByRole('button', { name: 'שכפול המשימה' }).click()
    const duplicate = page.getByRole('dialog', { name: 'משימה חדשה' })
    await expect(duplicate).toBeVisible()

    await page.goBack()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'משימות' })).toHaveAttribute('aria-current', 'page')
  })

  test('a sheet closed with its own button leaves no extra back step behind', async ({ page }) => {
    await seed(page, dishesDb())
    await page.goto('about:blank')
    await page.goto('/')
    await page.getByRole('button', { name: 'משימות' }).click()
    await page.getByRole('button', { name: 'עריכת לשטוף כלים' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'ביטול' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)

    // One back to Today (the tab), one to leave - not an extra one for the
    // sheet that is already gone.
    await page.goBack()
    await expect(page.getByRole('button', { name: 'היום' })).toHaveAttribute('aria-current', 'page')
    await page.goBack()
    await expect(page).toHaveURL('about:blank')
  })
})

test.describe('sheets as dialogs', () => {
  test('Escape closes the topmost sheet and focus returns to what opened it', async ({ page }) => {
    await seed(page, dishesDb())
    await page.goto('/')
    await page.getByRole('button', { name: 'משימות' }).click()
    const editButton = page.getByRole('button', { name: 'עריכת לשטוף כלים' })
    await editButton.click()
    await expect(page.getByRole('dialog', { name: 'עריכת משימה' })).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(editButton).toBeFocused()
  })

  test('Tab stays inside the open sheet', async ({ page }) => {
    await seed(page, dishesDb())
    await page.goto('/')
    await page.getByRole('button', { name: 'משימות' }).click()
    await page.getByRole('button', { name: 'עריכת לשטוף כלים' }).click()
    const dialog = page.getByRole('dialog', { name: 'עריכת משימה' })

    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab')
      const inside = await dialog.evaluate((el) => el.contains(document.activeElement))
      expect(inside).toBe(true)
    }
  })
})
