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
    // Exact match, not just "contains '30'" - guards against the cost label
    // ever doubling up the number again (it used to render "30 30 נקודות").
    await expect(movie.locator('.badge-points')).toHaveText('30 נקודות')

    // Far more expensive than the available balance: still listed, not
    // hidden - but it says how far off it is instead of offering a request
    // the server would refuse.
    const trip = page.locator('.task-card', { hasText: 'טיול לסוף שבוע' })
    await expect(trip).toContainText('500')
    await expect(trip.getByRole('button', { name: 'מימוש' })).toHaveCount(0)
    await expect(trip.getByRole('button', { name: 'חסרות 455' })).toBeDisabled()
    await expect(movie.getByRole('button', { name: 'מימוש' })).toBeEnabled()
  })

  test('requesting a redemption sends it for the other person to approve', async ({ page }) => {
    const db = makeFakeDb({
      profile: { ...makeFakeDb().profile, lifetime_points: 20, spendable_points: 20 },
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
    // Everyone else in the space is told there is something to approve.
    await expect.poll(() => db.redemptionNotifications).toEqual([{ redemptionId: db.redemptions[0].id }])
  })

  test('cancelling your own pending request removes it from the approval queue', async ({ page }) => {
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
      redemptions: [
        {
          id: 'redemption-1',
          space_id: FAKE_SPACE_ID,
          reward_id: 'reward-coffee',
          reward_title: 'קפה בבית קפה',
          cost: 15,
          requested_by: FAKE_USER_ID,
          approved_by: null,
          status: 'pending',
          requested_at: new Date().toISOString(),
          decided_at: null,
        },
      ],
    })
    await seed(page, db)
    await page.goto('/')
    await page.getByRole('button', { name: 'תגמולים' }).click()

    // A pending request of your own offers only Cancel - approve/reject are
    // for the other person, never for whoever asked for it.
    const pending = page.locator('.task-card', { hasText: 'הבקשה שלך' })
    await expect(pending.getByRole('button', { name: 'אישור' })).toHaveCount(0)
    await pending.getByRole('button', { name: 'ביטול', exact: false }).click()

    // Scoped to the toast: a bare getByText('בוטלה') also matched the whole
    // app once the history rendered - its last "בוטל" chip runs straight into
    // the "היום" tab, and that concatenation contains "בוטלה" too.
    await expect(page.locator('.toast')).toContainText('בוטלה')
    await expect(page.getByRole('heading', { name: 'ממתין לאישור' })).toHaveCount(0)
    expect(db.redemptions[0].status).toBe('cancelled')
    // And it is now in the history, marked as cancelled.
    await page.locator('.redemption-history summary').click()
    await expect(page.locator('.redemption-history .history-row', { hasText: 'קפה בבית קפה' })).toContainText('בוטל')
  })

  test('deleting a reward goes through a confirm sheet, not a browser dialog', async ({ page }) => {
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
    await page.getByRole('button', { name: 'עריכת קפה בבית קפה' }).click()

    await page.getByRole('button', { name: 'מחיקת התגמול' }).click()
    const sheet = page.locator('div.sheet', { hasText: 'מחיקת התגמול' })
    await expect(sheet).toBeVisible()
    await sheet.getByRole('button', { name: 'ביטול' }).click()
    await expect(sheet).toBeHidden()
    expect(db.rewards).toHaveLength(1)

    // Cancelling the confirm sheet only dismisses it - the edit form
    // underneath is still open, so a second attempt reuses it directly.
    await page.getByRole('button', { name: 'מחיקת התגמול' }).click()
    await page.locator('div.sheet', { hasText: 'מחיקת התגמול' }).getByRole('button', { name: 'מחיקת התגמול' }).click()

    await expect(page.getByText('התגמול נמחק.')).toBeVisible()
    expect(db.rewards).toHaveLength(0)
  })

  test('points promised to your own pending requests are held back from new ones', async ({ page }) => {
    const db = makeFakeDb({
      profile: { ...makeFakeDb().profile, lifetime_points: 100, spendable_points: 100 },
      rewards: [
        { id: 'r-dinner', space_id: FAKE_SPACE_ID, title: 'ארוחה בחוץ', description: null, cost: 60, created_by: FAKE_USER_ID, created_at: new Date().toISOString() },
        { id: 'r-movie', space_id: FAKE_SPACE_ID, title: 'ערב סרטים', description: null, cost: 50, created_by: FAKE_USER_ID, created_at: new Date().toISOString() },
      ],
      redemptions: [
        { id: 'red-1', space_id: FAKE_SPACE_ID, reward_id: 'r-dinner', reward_title: 'ארוחה בחוץ', cost: 60, requested_by: FAKE_USER_ID, approved_by: null, status: 'pending', requested_at: new Date().toISOString(), decided_at: null },
      ],
    })
    await seed(page, db)
    await page.goto('/')
    await page.getByRole('button', { name: 'תגמולים' }).click()

    await expect(page.locator('.reserved-note')).toHaveText('60 נקודות שמורות לבקשות שממתינות לאישור.')
    // 100 spendable, 60 already held: the 50-point movie is 10 short.
    const movie = page.locator('section.task-group .task-card', { hasText: 'ערב סרטים' })
    await expect(movie.getByRole('button', { name: 'חסרות 10' })).toBeDisabled()
  })

  test('approving someone else\'s request notifies them, and it moves to the history', async ({ page }) => {
    const db = makeFakeDb({
      otherPeople: [{ ...DANA_WITH_POINTS }],
      redemptions: [
        { id: 'red-dana', space_id: FAKE_SPACE_ID, reward_id: null, reward_title: 'בוקר בלי השכמה', cost: 40, requested_by: DANA_WITH_POINTS.id, approved_by: null, status: 'pending', requested_at: new Date().toISOString(), decided_at: null },
        { id: 'red-old', space_id: FAKE_SPACE_ID, reward_id: null, reward_title: 'גלידה', cost: 10, requested_by: FAKE_USER_ID, approved_by: DANA_WITH_POINTS.id, status: 'rejected', requested_at: new Date(Date.now() - 86_400_000).toISOString(), decided_at: new Date(Date.now() - 86_400_000).toISOString() },
      ],
    })
    await seed(page, db)
    await page.goto('/')
    await page.getByRole('button', { name: 'תגמולים' }).click()

    await page.getByRole('button', { name: 'אישור המימוש של בוקר בלי השכמה' }).click()

    await expect(page.getByText('אושר המימוש של בוקר בלי השכמה.')).toBeVisible()
    await expect.poll(() => db.redemptionNotifications).toEqual([{ redemptionId: 'red-dana' }])
    expect(db.otherPeople[0].spendable_points).toBe(60)

    const history = page.locator('.redemption-history')
    await expect(history.locator('summary')).toHaveText('היסטוריית מימושים (2)')
    await history.locator('summary').click()
    await expect(history.locator('.history-row', { hasText: 'בוקר בלי השכמה' })).toContainText('אושר')
    await expect(history.locator('.history-row', { hasText: 'גלידה' })).toContainText('נדחה')
  })
})

const DANA_WITH_POINTS = { id: '33333333-3333-4333-8333-333333333333', display_name: 'דנה כהן', avatar_url: null, email: 'dana@example.com', lifetime_points: 100, spendable_points: 100 }
