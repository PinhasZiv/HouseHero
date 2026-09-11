import { expect, test } from '@playwright/test'
import { FAKE_SPACE_ID, FAKE_USER_ID, installSupabaseMock, makeFakeDb, seedSession, type FakeDb } from './support/mockSupabase'

async function seed(page: import('@playwright/test').Page, db: FakeDb) {
  await seedSession(page)
  await page.addInitScript(() => window.localStorage.setItem('househero.language', 'he'))
  await installSupabaseMock(page, db)
}

test.describe('rewards', () => {
  test('lists rewards with their point cost, and shows the points bar', async ({ page }) => {
    const db = makeFakeDb({
      profile: {
        id: FAKE_USER_ID,
        email: 'test@example.com',
        display_name: 'Test Person',
        avatar_url: null,
        timezone: 'Asia/Jerusalem',
        language: 'he',
        lifetime_points: 120,
        spendable_points: 45,
      },
      rewards: [
        {
          id: 'reward-movie',
          space_id: FAKE_SPACE_ID,
          title: 'ערב סרטים',
          description: null,
          cost: 30,
          created_by: FAKE_USER_ID,
          created_at: new Date().toISOString(),
        },
        {
          id: 'reward-trip',
          space_id: FAKE_SPACE_ID,
          title: 'טיול לסוף שבוע',
          description: null,
          cost: 500,
          created_by: FAKE_USER_ID,
          created_at: new Date().toISOString(),
        },
      ],
    })
    await seed(page, db)
    await page.goto('/')
    await page.getByRole('button', { name: 'תגמולים' }).click()

    const tiles = page.locator('.points-value')
    await expect(tiles.nth(0)).toHaveText('120')
    await expect(tiles.nth(1)).toHaveText('45')

    const movie = page.locator('.task-card', { hasText: 'ערב סרטים' })
    await expect(movie).toContainText('30')

    // Far more expensive than the available balance: still listed, not
    // hidden - redeeming is always offered, the server is what actually
    // enforces the balance at approval time.
    const trip = page.locator('.task-card', { hasText: 'טיול לסוף שבוע' })
    await expect(trip).toContainText('500')
    await expect(trip.getByRole('button', { name: 'מימוש' })).toBeEnabled()
  })

  test('requesting a redemption sends it for the other person to approve', async ({ page }) => {
    const db = makeFakeDb({
      rewards: [
        {
          id: 'reward-coffee',
          space_id: FAKE_SPACE_ID,
          title: 'קפה בבית קפה',
          description: null,
          cost: 15,
          created_by: FAKE_USER_ID,
          created_at: new Date().toISOString(),
        },
      ],
    })
    await seed(page, db)
    await page.goto('/')
    await page.getByRole('button', { name: 'תגמולים' }).click()

    await page.locator('.task-card', { hasText: 'קפה בבית קפה' }).getByRole('button', { name: 'מימוש' }).click()

    await expect(page.getByText('נשלחה לאישור', { exact: false })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'ממתין לאישור' })).toBeVisible()
    expect(db.redemptions).toHaveLength(1)
    expect(db.redemptions[0]).toMatchObject({ status: 'pending', reward_title: 'קפה בבית קפה', cost: 15 })
  })
})
