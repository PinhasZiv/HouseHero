import { expect, test, type Page } from '@playwright/test'
import { FAKE_SPACE_ID, FAKE_USER_ID, installSupabaseMock, makeFakeDb, seedSession, type FakeDb, type FakeTask } from './support/mockSupabase'

// The top of the Today screen: how much of today is taken care of, and the
// household's streak - days in a row with nothing left for later.

function appToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date())
}

function shift(n: number): string {
  const [y, m, d] = appToday().split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

function task(id: string, title: string, overrides: Partial<FakeTask> = {}): FakeTask {
  return {
    id, space_id: FAKE_SPACE_ID, title, description: null,
    task_type: 'recurring', recurrence_mode: 'interval', interval_days: 1, weekly_days: null,
    end_condition: 'never', end_after_count: null, end_date: null, occurrences_completed: 0,
    points: 10, reminder_hour: 9, reminder_minute: 0, due_date: appToday(),
    last_completed_date: null, last_completed_at: null, last_completed_by: null, last_completed_actor: null,
    is_done: false, assigned_to: null, created_by: FAKE_USER_ID,
    // Noon on the day six days back - the same calendar day in Jerusalem.
    created_at: `${shift(-6)}T09:00:00Z`,
    starts_at: null, expires_at: null, reminder_policy: null, cancelled_at: null, expired_at: null,
    ...overrides,
  }
}

/** Done on its due date every day from six days ago through yesterday. */
function onTimeEveryDay(taskId: string): FakeDb['taskCompletions'] {
  return [6, 5, 4, 3, 2, 1].map((n) => ({
    id: `c-${taskId}-${n}`, task_id: taskId, user_id: FAKE_USER_ID, points_awarded: 10,
    completed_on: shift(-n), created_at: `${shift(-n)}T15:00:00Z`, completion_group: null, prev_due_date: shift(-n),
  }))
}

async function seed(page: Page, db: FakeDb) {
  await seedSession(page)
  await page.addInitScript(() => window.localStorage.setItem('househero.language', 'he'))
  await installSupabaseMock(page, db)
}

async function markDone(page: Page, title: string) {
  await page.locator('.task-card', { hasText: title }).locator('.task-checkbox').click()
  // Alone in the space, the "who did this?" picker is just a confirm.
  await page.getByRole('button', { name: 'אישור' }).click()
}

test('shows how much of today is taken care of, and updates as tasks are done', async ({ page }) => {
  const db = makeFakeDb({
    tasks: [
      task('a', 'לפרוק את המדיח'),
      task('b', 'להוציא את הזבל'),
      task('c', 'להשקות עציצים', { last_completed_date: appToday(), last_completed_at: new Date().toISOString(), last_completed_by: [FAKE_USER_ID], last_completed_actor: FAKE_USER_ID, due_date: shift(1) }),
    ],
  })
  await seed(page, db)
  await page.goto('/')

  const progress = page.locator('.today-progress')
  await expect(progress).toContainText('1 מתוך 3 טופלו היום')
  await expect(progress).toContainText('עוד 2 ותסגרו את היום')

  await markDone(page, 'לפרוק את המדיח')
  await expect(progress).toContainText('2 מתוך 3 טופלו היום')
  await expect(progress).toContainText('עוד אחת ותסגרו את היום')
})

test("counts the household's streak, and today joins it once today is cleared", async ({ page }) => {
  const db = makeFakeDb({ tasks: [task('dish', 'לפרוק את המדיח')], taskCompletions: onTimeEveryDay('dish') })
  await seed(page, db)
  await page.goto('/')

  const progress = page.locator('.today-progress')
  await expect(progress).toContainText('רצף של 6 ימים')

  await markDone(page, 'לפרוק את המדיח')
  await expect(progress).toContainText('כל המשימות של היום טופלו')
  await expect(progress).toContainText('רצף של 7 ימים')
})

test('a task done late breaks the streak on the day it was left', async ({ page }) => {
  // Done every day, except that four days ago it was left and made up the
  // next day: the streak runs from three days ago.
  const completions = onTimeEveryDay('dish').filter((row) => row.completed_on !== shift(-4))
  completions.find((row) => row.completed_on === shift(-3))!.prev_due_date = shift(-4)
  const db = makeFakeDb({ tasks: [task('dish', 'לפרוק את המדיח')], taskCompletions: completions })
  await seed(page, db)
  await page.goto('/')

  await expect(page.locator('.today-progress')).toContainText('רצף של 3 ימים')
})

test("an overdue task breaks the household's streak, even one assigned to someone else", async ({ page }) => {
  const db = makeFakeDb({
    tasks: [
      task('dish', 'לפרוק את המדיח'),
      // Dana's weekly chore, due three days ago and still open. This person
      // never sees its reminder, but it is the household's streak.
      task('laundry', 'לקפל כביסה', { due_date: shift(-3), interval_days: 7, assigned_to: '33333333-3333-4333-8333-333333333333' }),
    ],
    taskCompletions: onTimeEveryDay('dish'),
    otherPeople: [{ id: '33333333-3333-4333-8333-333333333333', display_name: 'דנה', avatar_url: null, email: null, lifetime_points: 0, spendable_points: 0 }],
  })
  await seed(page, db)
  await page.goto('/')

  await expect(page.locator('.today-progress')).toContainText('רצף של יומיים')
})

test('points to spend sit in the top bar and lead to the rewards', async ({ page }) => {
  const db = makeFakeDb({ tasks: [task('a', 'לפרוק את המדיח')] })
  db.profile.spendable_points = 85
  await seed(page, db)
  await page.goto('/')

  const chip = page.getByRole('button', { name: '85 נקודות זמינות למימוש' })
  await expect(chip).toBeVisible()
  await chip.click()
  await expect(page.locator('.tab-bar .tab-active')).toContainText('תגמולים')
  // The Rewards screen shows them itself.
  await expect(chip).toHaveCount(0)
})

test("a card's actions say what they do, and Today's due list drops its repeated badge", async ({ page }) => {
  const db = makeFakeDb({ tasks: [task('a', 'לפרוק את המדיח')] })
  await seed(page, db)
  await page.goto('/')

  const card = page.locator('.task-card', { hasText: 'לפרוק את המדיח' })
  await expect(card.getByRole('button', { name: 'השהיית התזכורת של לפרוק את המדיח' })).toContainText('השהיה')
  await expect(card.getByRole('button', { name: 'דילוג על לפרוק את המדיח הפעם' })).toContainText('דילוג')
  await expect(card.locator('.badge-due')).toHaveCount(0)
})

test('marking a task done gives a short buzz where the phone supports it', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value: (pattern: number) => {
        ;(window as { __buzz?: number }).__buzz = pattern
        return true
      },
    })
  })
  const db = makeFakeDb({ tasks: [task('a', 'לפרוק את המדיח')] })
  await seed(page, db)
  await page.goto('/')

  await markDone(page, 'לפרוק את המדיח')
  await expect.poll(() => page.evaluate(() => (window as { __buzz?: number }).__buzz)).toBe(15)
})
