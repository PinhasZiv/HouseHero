import { expect, test } from '@playwright/test'
import { FAKE_SPACE_ID, FAKE_USER_ID, installSupabaseMock, makeFakeDb, seedSession, type FakeDb, type FakeTask } from './support/mockSupabase'

// A time-limited task: relevant only inside a start/end window, reminding on
// its own cadence within it, and settling into scheduled/active/expired
// rather than the ordinary late/due/upcoming story. See taskDue.ts's
// classifyTimeLimited() for the status rules these exercise from the UI.

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

function windowTask(overrides: Partial<FakeTask> & { id: string; title: string }): FakeTask {
  return {
    space_id: FAKE_SPACE_ID,
    description: null,
    task_type: 'time_limited',
    recurrence_mode: null,
    interval_days: null,
    weekly_days: null,
    end_condition: 'never',
    end_after_count: null,
    end_date: null,
    occurrences_completed: 0,
    points: 10,
    reminder_hour: 17,
    reminder_minute: 0,
    due_date: isoDaysFromToday(0),
    last_completed_date: null,
    last_completed_at: null,
    last_completed_by: null,
    last_completed_actor: null,
    is_done: false,
    assigned_to: null,
    created_by: FAKE_USER_ID,
    created_at: new Date().toISOString(),
    starts_at: null,
    expires_at: null,
    reminder_policy: {
      mode: 'interval',
      intervalMinutes: 30,
      intervalUnit: 'minutes',
      dailyIntervalDays: null,
      dailyHour: null,
      dailyMinute: null,
      finalReminderMinutesBeforeExpiry: null,
    },
    cancelled_at: null,
    expired_at: null,
    ...overrides,
  }
}

test.describe('creating a time-limited task', () => {
  test('fills in a window and a reminder cadence, and saves it as time_limited', async ({ page }) => {
    const db = makeFakeDb({})
    await seed(page, db)
    await page.goto('/')
    await page.getByRole('button', { name: 'משימות' }).click()
    await page.getByRole('button', { name: 'הוספת המשימה הראשונה' }).click()

    await page.locator('#task-title').fill('לקנות חלב בדרך הביתה')
    await page.getByRole('button', { name: 'מוגבלת בזמן' }).click()
    await page.getByRole('button', { name: 'כל X' }).click()
    await page.locator('.sheet').getByRole('button', { name: 'הוספת משימה' }).click()

    await expect(page.getByText('לקנות חלב בדרך הביתה נוספה.')).toBeVisible()
    const created = db.tasks.find((t) => t.title === 'לקנות חלב בדרך הביתה')
    expect(created?.task_type).toBe('time_limited')
    expect(created?.starts_at).toBeTruthy()
    expect(created?.expires_at).toBeTruthy()
    expect(created?.reminder_policy).toEqual({
      mode: 'interval',
      intervalMinutes: 30,
      intervalUnit: 'minutes',
      dailyIntervalDays: null,
      dailyHour: null,
      dailyMinute: null,
      finalReminderMinutesBeforeExpiry: null,
    })
  })

  test('can pick an hours cadence or a daily cadence with a time of day', async ({ page }) => {
    const db = makeFakeDb({})
    await seed(page, db)
    await page.goto('/')
    await page.getByRole('button', { name: 'משימות' }).click()
    await page.getByRole('button', { name: 'הוספת המשימה הראשונה' }).click()

    await page.locator('#task-title').fill('לאסוף חבילה מהדואר')
    await page.getByRole('button', { name: 'מוגבלת בזמן' }).click()
    await page.getByRole('button', { name: 'כל X' }).click()
    await page.getByRole('button', { name: 'ימים', exact: true }).click()
    await page.getByRole('spinbutton', { name: 'מספר הימים בין תזכורת לתזכורת' }).fill('2')
    await page.getByLabel('שעת התזכורת היומית').fill('08:30')
    await page.locator('.sheet').getByRole('button', { name: 'הוספת משימה' }).click()

    await expect(page.getByText('לאסוף חבילה מהדואר נוספה.')).toBeVisible()
    const created = db.tasks.find((t) => t.title === 'לאסוף חבילה מהדואר')
    expect(created?.reminder_policy).toEqual({
      mode: 'daily',
      intervalMinutes: null,
      intervalUnit: null,
      dailyIntervalDays: 2,
      dailyHour: 8,
      dailyMinute: 30,
      finalReminderMinutesBeforeExpiry: null,
    })
  })
})

test.describe('a time-limited task before its window opens', () => {
  test('shows as scheduled on the Tasks screen, and on Today only when it starts today', async ({ page }) => {
    // The mocked profile lives in Asia/Jerusalem (UTC+2/+3) - a plain
    // `Date.now() + 1h` occasionally lands after local midnight whenever the
    // suite happens to run late in the evening there, which quietly moves
    // "task-today" onto tomorrow and fails this test. Anchoring both the
    // fixture and the app's own clock to a fixed midday instant instead
    // makes the test's outcome independent of when it actually runs.
    const FIXED_NOW = Date.parse('2026-01-15T09:00:00.000Z') // 11:00 in Asia/Jerusalem
    const db = makeFakeDb({
      tasks: [
        windowTask({
          id: 'task-today',
          title: 'משימה שמתחילה היום',
          starts_at: new Date(FIXED_NOW + 60 * 60_000).toISOString(),
          expires_at: new Date(FIXED_NOW + 3 * 60 * 60_000).toISOString(),
        }),
        windowTask({
          id: 'task-later',
          title: 'לאסוף חבילה בעוד כמה ימים',
          starts_at: new Date(FIXED_NOW + 3 * 86_400_000).toISOString(),
          expires_at: new Date(FIXED_NOW + 4 * 86_400_000).toISOString(),
        }),
      ],
    })
    await seed(page, db)
    await page.clock.install({ time: FIXED_NOW })
    await page.goto('/')

    // Only the one starting later today belongs on "today".
    await expect(page.locator('.task-card', { hasText: 'משימה שמתחילה היום' })).toBeVisible()
    await expect(page.locator('.task-card', { hasText: 'לאסוף חבילה' })).toHaveCount(0)

    await page.getByRole('button', { name: 'משימות' }).click()
    await expect(page.locator('.task-card', { hasText: 'משימה שמתחילה היום' })).toBeVisible()
    await expect(page.locator('.task-card', { hasText: 'לאסוף חבילה' })).toBeVisible()
  })
})

test.describe('a time-limited task inside its window', () => {
  test('is shown prominently as active, with the correct checkbox and window text', async ({ page }) => {
    const db = makeFakeDb({
      tasks: [
        windowTask({
          id: 'task-active',
          title: 'לקנות חלב',
          starts_at: new Date(Date.now() - 60 * 60_000).toISOString(),
          expires_at: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
        }),
      ],
    })
    await seed(page, db)
    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'רלוונטי עכשיו' })).toBeVisible()
    const card = page.locator('.task-card', { hasText: 'לקנות חלב' })
    await expect(card).toHaveClass(/task-active/)
    await expect(card).toContainText('פעיל עכשיו')
    await expect(card).toContainText('בתוקף עד')
    await expect(card.locator('.task-checkbox')).not.toHaveClass(/task-checkbox-checked/)
  })

  test('tapping the checkbox opens the completion picker, same as any other task', async ({ page }) => {
    const db = makeFakeDb({
      tasks: [
        windowTask({
          id: 'task-active',
          title: 'לקנות חלב',
          starts_at: new Date(Date.now() - 60 * 60_000).toISOString(),
          expires_at: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
        }),
      ],
    })
    await seed(page, db)
    await page.goto('/')

    await page.locator('.task-card', { hasText: 'לקנות חלב' }).locator('.task-checkbox').click()
    await expect(page.getByRole('heading', { name: 'מי ביצע את זה?' })).toBeVisible()
    await page.getByRole('button', { name: 'אישור' }).click()

    // Completing is async (a real round trip through the mock) - wait for
    // its visible effect before asserting on the server-side state.
    await expect(page.getByText('נקודות', { exact: false })).toBeVisible()
    expect(db.tasks[0].is_done).toBe(true)
    expect(db.tasks[0].last_completed_date).toBeTruthy()
  })
})

test.describe('cancelling a time-limited task', () => {
  test('the cancel action marks it cancelled and moves it out of the open list', async ({ page }) => {
    const db = makeFakeDb({
      tasks: [
        windowTask({
          id: 'task-active',
          title: 'לקנות חלב',
          starts_at: new Date(Date.now() - 60 * 60_000).toISOString(),
          expires_at: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
        }),
      ],
    })
    await seed(page, db)
    await page.goto('/')
    await page.getByRole('button', { name: 'משימות' }).click()

    await page.locator('.task-card', { hasText: 'לקנות חלב' }).getByRole('button', { name: 'ביטול לקנות חלב' }).click()

    // The cancel action is async (a real round trip through the mock) - wait
    // for its visible effect before asserting on the server-side state.
    await expect(page.locator('.completed-group')).toBeVisible()
    expect(db.tasks[0].is_done).toBe(true)
    expect(db.tasks[0].cancelled_at).toBeTruthy()
    await page.locator('.completed-group summary').click()
    await expect(page.locator('.completed-group .task-card', { hasText: 'לקנות חלב' })).toContainText('בוטלה')
  })
})

test.describe('a time-limited task whose window has already closed', () => {
  test('shows as expired even before the periodic sweep flips is_done', async ({ page }) => {
    const db = makeFakeDb({
      tasks: [
        windowTask({
          id: 'task-expired',
          title: 'משימה שפג תוקפה',
          starts_at: new Date(Date.now() - 3 * 60 * 60_000).toISOString(),
          expires_at: new Date(Date.now() - 60 * 60_000).toISOString(),
          is_done: false,
        }),
      ],
    })
    await seed(page, db)
    await page.goto('/')
    await page.getByRole('button', { name: 'משימות' }).click()
    await page.locator('.completed-group summary').click()

    const card = page.locator('.completed-group .task-card', { hasText: 'משימה שפג תוקפה' })
    await expect(card).toBeVisible()
    await expect(card).toContainText('פג תוקף')
  })

  test('offers duplicate, which opens a prefilled create form rather than reactivating it', async ({ page }) => {
    const db = makeFakeDb({
      tasks: [
        windowTask({
          id: 'task-expired',
          title: 'לאסוף חבילה מהדואר',
          starts_at: new Date(Date.now() - 5 * 86_400_000).toISOString(),
          expires_at: new Date(Date.now() - 1 * 86_400_000).toISOString(),
          is_done: true,
          expired_at: new Date(Date.now() - 1 * 86_400_000).toISOString(),
          points: 15,
        }),
      ],
    })
    await seed(page, db)
    await page.goto('/')
    await page.getByRole('button', { name: 'משימות' }).click()
    await page.locator('.completed-group summary').click()

    await page
      .locator('.completed-group .task-card', { hasText: 'לאסוף חבילה מהדואר' })
      .getByRole('button', { name: 'שכפול לאסוף חבילה מהדואר' })
      .click()

    await expect(page.getByRole('heading', { name: 'משימה חדשה' })).toBeVisible()
    await expect(page.locator('#task-title')).toHaveValue('לאסוף חבילה מהדואר')

    await page.locator('.sheet').getByRole('button', { name: 'הוספת משימה' }).click()

    // A new task was created - the expired original is untouched.
    expect(db.tasks).toHaveLength(2)
    const original = db.tasks.find((t) => t.id === 'task-expired')
    expect(original?.is_done).toBe(true)
    const duplicate = db.tasks.find((t) => t.id !== 'task-expired')
    expect(duplicate?.title).toBe('לאסוף חבילה מהדואר')
    expect(duplicate?.points).toBe(15)
    expect(duplicate?.is_done).toBe(false)
  })
})
