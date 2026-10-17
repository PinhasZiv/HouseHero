import { expect, test, type Page } from '@playwright/test'
import { FAKE_SPACE_ID, FAKE_USER_ID, installSupabaseMock, makeFakeDb, seedSession, type FakeDb, type FakeTask } from './support/mockSupabase'

// The weekly report: what the Saturday-evening notification opens on, and
// what a row on the Stats screen opens - one household's Sunday-to-Saturday.

const DANA = { id: '33333333-3333-4333-8333-333333333333', display_name: 'דנה', avatar_url: null, email: 'dana@example.com', lifetime_points: 0, spendable_points: 0 }

function appToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date())
}

function shift(from: string, n: number): string {
  const [y, m, d] = from.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** The Saturday that closes the latest week to have reached its Saturday. */
function latestSaturday(): string {
  const today = appToday()
  const [y, m, d] = today.split('-').map(Number)
  return shift(today, -((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 1) % 7))
}

const SAT = latestSaturday()
const SUN = shift(SAT, -6)

function task(id: string, title: string, overrides: Partial<FakeTask> = {}): FakeTask {
  return {
    id, space_id: FAKE_SPACE_ID, title, description: null,
    task_type: 'recurring', recurrence_mode: 'interval', interval_days: 1, weekly_days: null,
    end_condition: 'never', end_after_count: null, end_date: null, occurrences_completed: 0,
    points: 10, reminder_hour: 9, reminder_minute: 0, due_date: shift(appToday(), 1),
    last_completed_date: appToday(), last_completed_at: new Date().toISOString(), last_completed_by: [FAKE_USER_ID], last_completed_actor: FAKE_USER_ID,
    is_done: false, assigned_to: null, created_by: FAKE_USER_ID, created_at: `${shift(SAT, -30)}T09:00:00Z`,
    starts_at: null, expires_at: null, reminder_policy: null, cancelled_at: null, expired_at: null,
    ...overrides,
  }
}

/** The dishes on each day of the reported week: me on 4 days, Dana on 3. */
function weekOfDishes(): FakeDb['taskCompletions'] {
  return [0, 1, 2, 3, 4, 5, 6].map((i) => {
    const on = shift(SUN, i)
    return {
      id: `c${i}`, task_id: 'dish', user_id: i % 2 ? DANA.id : FAKE_USER_ID, points_awarded: 10,
      completed_on: on, created_at: `${on}T17:00:00Z`, completion_group: null, prev_due_date: on,
    }
  })
}

async function seed(page: Page, db: FakeDb) {
  await seedSession(page)
  await page.addInitScript(() => window.localStorage.setItem('househero.language', 'he'))
  await installSupabaseMock(page, db)
}

test('the notification opens the report on its own week', async ({ page }) => {
  // Every completion from that Sunday on, so the days after it stay clean too.
  const db = makeFakeDb({ otherPeople: [DANA], tasks: [task('dish', 'לפרוק את המדיח')], taskCompletions: weekOfDishes() })
  await seed(page, db)
  await page.goto(`/?tab=stats&week=${SAT}`)

  await expect(page.getByRole('heading', { level: 1, name: 'הדוח השבועי' })).toBeVisible()
  const kpis = page.locator('.report-kpi')
  await expect(kpis.filter({ hasText: 'משימות בוצעו' })).toContainText('7')
  await expect(kpis.filter({ hasText: 'נקודות נצברו' })).toContainText('70')
  await expect(kpis.filter({ hasText: 'בזמן או לפני' })).toContainText('100%')
  // Nothing at all the week before: up by everything.
  await expect(kpis.filter({ hasText: 'משימות בוצעו' })).toContainText('▲ 7 מהשבוע שעבר')

  const people = page.locator('.report-person')
  await expect(people.first()).toContainText('אתה')
  await expect(people.first()).toContainText('במקום הראשון')
  await expect(people.first()).toContainText("40 נק'")
  await expect(people.nth(1)).toContainText('דנה')

  await expect(page.locator('.report-days:not(.report-days-outlook) .report-day')).toHaveCount(7)
  await expect(page.locator('.card', { hasText: 'בולטות השבוע' })).toContainText('לפרוק את המדיח')
  // The one-shot parameter is gone - a reload lands on the plain Stats screen.
  expect(new URL(page.url()).searchParams.get('week')).toBeNull()
})

test('moves between weeks, and back returns to the stats', async ({ page }) => {
  await seed(page, makeFakeDb({ tasks: [task('dish', 'לפרוק את המדיח')], taskCompletions: weekOfDishes() }))
  await page.goto('/?tab=stats')

  // The report's row stands apart from the range toggle below it.
  const row = await page.locator('.report-entry').boundingBox()
  const toggle = await page.locator('.segmented').boundingBox()
  expect(toggle!.y - (row!.y + row!.height)).toBeGreaterThanOrEqual(12)

  await page.getByRole('button', { name: /הדוח השבועי/ }).click()
  const kpiDone = page.locator('.report-kpi', { hasText: 'משימות בוצעו' })
  await expect(kpiDone).toContainText('7')

  await page.getByRole('button', { name: 'השבוע הקודם' }).click()
  await expect(kpiDone.locator('.report-kpi-value')).toHaveText('0')
  await page.getByRole('button', { name: 'השבוע הבא' }).click()
  await expect(kpiDone.locator('.report-kpi-value')).toHaveText('7')

  await page.getByRole('button', { name: 'חזרה' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'סטטיסטיקות' })).toBeVisible()

  // The phone's back does the same.
  await page.getByRole('button', { name: /הדוח השבועי/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'הדוח השבועי' })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('heading', { level: 1, name: 'סטטיסטיקות' })).toBeVisible()
})

test('a task left for later shows on the day it broke, in the highlights and in the streak', async ({ page }) => {
  const completions = weekOfDishes().filter((row) => row.completed_on !== shift(SUN, 3))
  completions.find((row) => row.completed_on === shift(SUN, 4))!.prev_due_date = shift(SUN, 3)
  await seed(page, makeFakeDb({ tasks: [task('dish', 'לפרוק את המדיח')], taskCompletions: completions }))
  await page.goto(`/?tab=stats&week=${SAT}`)

  await expect(page.locator('.report-day-broken')).toHaveCount(1)
  await expect(page.locator('.report-kpi', { hasText: 'ימים נסגרו במלואם' })).toContainText('6/7')
  await expect(page.locator('.report-list-late')).toContainText('לפרוק את המדיח')
  await expect(page.locator('.card', { hasText: 'רצף הבית' })).toContainText('נשבר ביום רביעי')
})

test('looks ahead to the week after: each day, and what is assigned to me', async ({ page }) => {
  const db = makeFakeDb({
    tasks: [
      task('dish', 'לפרוק את המדיח'),
      task('trash', 'להוציא את הזבל', { interval_days: 7, due_date: shift(appToday(), 1), assigned_to: FAKE_USER_ID }),
    ],
    taskCompletions: weekOfDishes(),
  })
  await seed(page, db)
  await page.goto(`/?tab=stats&week=${SAT}`)

  const outlook = page.locator('.report-outlook')
  // "Next week" on the Saturday it is sent, "the rest of this week" after.
  await expect(outlook.getByRole('heading', { level: 3 })).toHaveText(/מבט לשבוע הבא|מה נשאר השבוע/)
  await expect(outlook.locator('.report-day')).toHaveCount(7)
  await expect(outlook.locator('.report-list')).toContainText('להוציא את הזבל')
  await expect(outlook.locator('.report-list')).toContainText('פעם אחת')
})

test('offers one interval change, which applies from the report, or waits when put off', async ({ page }) => {
  // The fridge, weekly, skipped five weeks running.
  const skips = [4, 11, 18, 25, 32].map((back, i) => {
    const on = shift(appToday(), -back)
    return {
      id: `s${i}`, task_id: 'fridge', space_id: FAKE_SPACE_ID, user_id: FAKE_USER_ID, skipped_on: on, created_at: `${on}T10:00:00Z`,
      prev_due_date: on, prev_last_skipped_date: null, prev_last_skipped_by: null, prev_is_done: false,
    }
  })
  const db = makeFakeDb({
    tasks: [
      task('dish', 'לפרוק את המדיח'),
      task('fridge', 'לנקות את המקרר', { interval_days: 7, due_date: shift(appToday(), 3), last_completed_date: null, last_completed_at: null, last_completed_by: null, last_completed_actor: null }),
    ],
    taskCompletions: weekOfDishes(),
    taskSkips: skips,
  })
  await seed(page, db)
  await page.goto(`/?tab=stats&week=${SAT}`)

  const card = page.locator('.card', { hasText: 'הצעה לשיפור' })
  await expect(card).toContainText('לנקות את המקרר')
  await card.getByRole('button', { name: /^לשנות ל/ }).click()
  await expect.poll(() => db.tasks.find((row) => row.id === 'fridge')?.interval_days).toBe(11)

  await card.getByRole('button', { name: 'לא עכשיו' }).click()
  await expect(card).toBeHidden()
})

test('a vacation leaves its days out, and says whose it was', async ({ page }) => {
  const db = makeFakeDb({
    otherPeople: [DANA],
    tasks: [task('dish', 'לפרוק את המדיח')],
    taskCompletions: weekOfDishes().filter((row) => row.completed_on !== shift(SUN, 2) && row.completed_on !== shift(SUN, 3)),
    pauses: [
      { id: 'p1', space_id: FAKE_SPACE_ID, user_id: null, started_on: shift(SUN, 2), ended_on: shift(SUN, 4) },
      { id: 'p2', space_id: FAKE_SPACE_ID, user_id: DANA.id, started_on: shift(SUN, 5), ended_on: shift(SUN, 6) },
    ],
  })
  await seed(page, db)
  await page.goto(`/?tab=stats&week=${SAT}`)

  await expect(page.locator('.report-day-away')).toHaveCount(2)
  await expect(page.locator('.report-kpi', { hasText: 'ימים נסגרו במלואם' })).toContainText('5/5')
  await expect(page.locator('.report-away').first()).toContainText('חופשה של כל הבית')
  await expect(page.locator('.report-away').nth(1)).toContainText('חופשה של דנה')
})
