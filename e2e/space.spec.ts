import { expect, test } from '@playwright/test'
import { installSupabaseMock, makeFakeDb, seedSession } from './support/mockSupabase'

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
