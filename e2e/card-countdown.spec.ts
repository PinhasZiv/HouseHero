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
    task_type: 'recurring', recurrence_mode: 'interval', interval_days: 14, weekly_days: null,
    end_condition: 'never', end_after_count: null, end_date: null, occurrences_completed: 0,
    points: 5, reminder_hour: 9, reminder_minute: 0, due_date: appToday(),
    last_completed_date: null, last_completed_at: null, last_completed_by: null, last_completed_actor: null,
    is_done: false, assigned_to: null, created_by: FAKE_USER_ID, created_at: new Date().toISOString(),
    starts_at: null, expires_at: null, reminder_policy: null, cancelled_at: null, expired_at: null,
    ...overrides,
  }
}

test('a card shows only how long until the next time - not the date or the repeat pattern', async ({ page }) => {
  const db = makeFakeDb({
    tasks: [
      task('soon', 'לנקות את המקרר', { due_date: shift(1) }),
      task('later', 'להחליף מצעים', { due_date: shift(5), reminder_hour: 18 }),
    ],
  })
  await seed(page, db)
  await page.goto('/')
  await page.locator('.tab-bar').getByRole('button', { name: 'משימות' }).click()

  const soon = page.locator('.task-card', { hasText: 'לנקות את המקרר' })
  await expect(soon.locator('.task-countdown')).toHaveText('מחר')
  const later = page.locator('.task-card', { hasText: 'להחליף מצעים' })
  await expect(later.locator('.task-countdown')).toHaveText('עוד 5 ימים')
  // The reminder time stays - it tells apart copies of one chore.
  await expect(later.locator('.task-meta-time')).toHaveText('18:00')
  await expect(later).not.toContainText('יעד')
  await expect(later).not.toContainText('פעם בשבועיים')
})

test('a task done today counts down to its next time', async ({ page }) => {
  const db = makeFakeDb({
    tasks: [
      task('done', 'להשקות עציצים', {
        due_date: shift(3),
        last_completed_date: appToday(),
        last_completed_at: new Date().toISOString(),
        last_completed_by: [FAKE_USER_ID],
        last_completed_actor: FAKE_USER_ID,
      }),
    ],
  })
  await seed(page, db)
  await page.goto('/')
  await page.locator('.completed-group summary').click()
  const card = page.locator('.task-card', { hasText: 'להשקות עציצים' })
  await expect(card).toContainText('בוצעה על ידך')
  await expect(card.locator('.task-countdown')).toHaveText('עוד 3 ימים')
})

test('due today shows no countdown - its badge already says so', async ({ page }) => {
  const db = makeFakeDb({ tasks: [task('today', 'להוציא זבל')] })
  await seed(page, db)
  await page.goto('/')
  const card = page.locator('.task-card', { hasText: 'להוציא זבל' })
  await expect(card.locator('.badge-due')).toBeVisible()
  await expect(card.locator('.task-countdown')).toHaveCount(0)
})

test('the date and the repeat pattern are in the details sheet', async ({ page }) => {
  const db = makeFakeDb({ tasks: [task('soon', 'לנקות את המקרר', { due_date: shift(1) })] })
  await seed(page, db)
  await page.goto('/')
  await page.locator('.tab-bar').getByRole('button', { name: 'משימות' }).click()
  await page.locator('.task-card', { hasText: 'לנקות את המקרר' }).locator('.task-main').click()

  const sheet = page.getByRole('dialog', { name: 'לנקות את המקרר' })
  await expect(sheet).toContainText('המופע הבא')
  await expect(sheet).toContainText('מחר')
  await expect(sheet).toContainText('פעם בשבועיים')
})

test('a long name wraps to two lines before it is cut', async ({ page }) => {
  const long = 'לנקות את המסננים של המזגן בסלון ובחדר השינה ולבדוק שהמים מתנקזים כמו שצריך'
  const db = makeFakeDb({ tasks: [task('long', long, { due_date: shift(4) })] })
  await seed(page, db)
  await page.goto('/')
  await page.locator('.tab-bar').getByRole('button', { name: 'משימות' }).click()

  const name = page.locator('.task-card .task-name')
  const lineHeight = await name.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight))
  const height = (await name.boundingBox())?.height ?? 0
  expect(Math.round(height / lineHeight)).toBe(2)
})

test('a weekly task a full week overdue is due today in its details too, not "a week ago"', async ({ page }) => {
  const db = makeFakeDb({
    tasks: [
      task('wrapped', 'ניקוי שירותים', { interval_days: 7, due_date: shift(-7) }),
      task('late', 'ניקיון בית', { interval_days: 7, due_date: shift(-9) }),
    ],
  })
  await seed(page, db)
  await page.goto('/')
  await page.locator('.tab-bar').getByRole('button', { name: 'משימות' }).click()

  const wrapped = page.locator('.task-card', { hasText: 'ניקוי שירותים' })
  await expect(wrapped.locator('.badge-due')).toBeVisible()
  await wrapped.locator('.task-main').click()
  const sheet = page.getByRole('dialog', { name: 'ניקוי שירותים' })
  await expect(sheet).toContainText('המופע הנוכחי')
  await expect(sheet).toContainText('היום')
  await expect(sheet).not.toContainText('לפני')
  await sheet.getByRole('button', { name: 'סגירה' }).click()

  // Nine days on a weekly cycle: two days into the second missed week -
  // matching its "two days late" badge.
  const late = page.locator('.task-card', { hasText: 'ניקיון בית' })
  await expect(late.locator('.badge-late')).toContainText('יומיים')
  await late.locator('.task-main').click()
  await expect(page.getByRole('dialog', { name: 'ניקיון בית' })).toContainText('לפני יומיים')
})
