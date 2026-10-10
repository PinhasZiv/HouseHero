import { expect, test } from '@playwright/test'
import { FAKE_SPACE_ID, FAKE_USER_ID, installSupabaseMock, makeFakeDb, seedSession, type FakeDb, type FakeTask } from './support/mockSupabase'

/** "Today" as the app itself sees it - the fake profile's own timezone. */
function appToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date())
}

function shift(n: number): string {
  const [y, m, d] = appToday().split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

async function seed(page: import('@playwright/test').Page, db: FakeDb) {
  await seedSession(page)
  await page.addInitScript(() => window.localStorage.setItem('househero.language', 'he'))
  await installSupabaseMock(page, db)
}

function task(id: string, title: string, overrides: Partial<FakeTask> = {}): FakeTask {
  return {
    id, space_id: FAKE_SPACE_ID, title, description: null,
    task_type: 'recurring', recurrence_mode: 'interval', interval_days: 7, weekly_days: null,
    end_condition: 'never', end_after_count: null, end_date: null, occurrences_completed: 0,
    points: 5, reminder_hour: 9, reminder_minute: 0, due_date: shift(7),
    last_completed_date: appToday(), last_completed_at: new Date().toISOString(), last_completed_by: [FAKE_USER_ID], last_completed_actor: FAKE_USER_ID,
    is_done: false, assigned_to: null, created_by: FAKE_USER_ID, created_at: new Date().toISOString(),
    starts_at: null, expires_at: null, reminder_policy: null, cancelled_at: null, expired_at: null,
    ...overrides,
  }
}

function done(taskId: string, daysAgo: number, prevDueDaysAgo: number) {
  return {
    id: `${taskId}-${daysAgo}`, task_id: taskId, user_id: FAKE_USER_ID, points_awarded: 5,
    completed_on: shift(-daysAgo), created_at: `${shift(-daysAgo)}T10:00:00Z`, completion_group: null,
    prev_due_date: shift(-prevDueDaysAgo),
  }
}

// Set to every 7 days, but done every 4 - each time three days early.
function earlyBird(): FakeDb {
  return makeFakeDb({
    tasks: [task('washer', 'להכניס מכונת כביסה')],
    taskCompletions: [0, 4, 8, 12, 16, 20].map((ago) => done('washer', ago, ago - 3)),
  })
}

test('stats break down when tasks get done, and suggest a shorter interval for one done early', async ({ page }) => {
  const db = earlyBird()
  await seed(page, db)
  await page.goto('/')
  await page.locator('.tab-bar').getByRole('button', { name: 'סטטיסטיקות' }).click()

  await expect(page.locator('.timing-early .timing-count')).toHaveText('6')
  await expect(page.locator('.timing-late .timing-count')).toHaveText('0')

  const suggestion = page.locator('.suggestion', { hasText: 'להכניס מכונת כביסה' })
  await expect(suggestion).toContainText('בפועל מבוצעת בערך כל 4 ימים')
  await suggestion.getByRole('button', { name: 'לשנות לכל 4 ימים' }).click()

  await expect(page.locator('.toast')).toContainText('תחזור מעכשיו כל 4 ימים')
  const washer = db.tasks.find((t) => t.id === 'washer')!
  expect(washer.interval_days).toBe(4)
  // From the last completion (today) at the new pace.
  expect(washer.due_date).toBe(shift(4))
  await expect(page.locator('.suggestion')).toHaveCount(0)
})

test('"not now" hides a suggestion, and it stays hidden', async ({ page }) => {
  const db = earlyBird()
  await seed(page, db)
  await page.goto('/')
  await page.locator('.tab-bar').getByRole('button', { name: 'סטטיסטיקות' }).click()

  await page.locator('.suggestion').getByRole('button', { name: 'לא עכשיו' }).click()
  await expect(page.locator('.suggestion')).toHaveCount(0)
  expect(db.tasks[0].interval_days).toBe(7)

  await page.reload()
  await page.locator('.tab-bar').getByRole('button', { name: 'סטטיסטיקות' }).click()
  await expect(page.locator('.timing-early')).toBeVisible()
  await expect(page.locator('.suggestion')).toHaveCount(0)
})

test('a task mostly skipped or missed gets a suggestion to repeat less often', async ({ page }) => {
  const db = makeFakeDb({
    tasks: [task('fridge', 'לאפס את המקרר', { interval_days: 2, due_date: shift(2) })],
    taskCompletions: [done('fridge', 0, 4), done('fridge', 20, 20)],
    taskSkips: [16, 12, 8].map((ago) => ({
      id: `s-${ago}`, task_id: 'fridge', space_id: FAKE_SPACE_ID, user_id: FAKE_USER_ID, skipped_on: shift(-ago),
      created_at: `${shift(-ago)}T10:00:00Z`, prev_due_date: shift(-ago), prev_last_skipped_date: null,
      prev_last_skipped_by: null, prev_is_done: false,
    })),
  })
  await seed(page, db)
  await page.goto('/')
  await page.locator('.tab-bar').getByRole('button', { name: 'סטטיסטיקות' }).click()

  const suggestion = page.locator('.suggestion', { hasText: 'לאפס את המקרר' })
  await expect(suggestion).toContainText('דולגו או התפספסו')
  await expect(suggestion.getByRole('button', { name: /לשנות ל/ })).toHaveText('לשנות לכל 4 ימים')
})

test("a task's details sum up its own rhythm over the last 60 days", async ({ page }) => {
  await seed(page, earlyBird())
  await page.goto('/')
  // Done today, so it sits in Today's collapsed "done" group.
  await page.locator('.completed-group summary').click()
  await page.locator('.task-card', { hasText: 'להכניס מכונת כביסה' }).locator('.task-main').click()

  await expect(page.locator('.cadence-summary')).toHaveText('ב-60 הימים האחרונים: 6 לפני הזמן · בפועל כל 4 ימים')
})
