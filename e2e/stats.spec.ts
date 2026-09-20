import { expect, test } from '@playwright/test'
import { FAKE_SPACE_ID, FAKE_USER_ID, installSupabaseMock, makeFakeDb, seedSession, type FakeDb, type FakeTask } from './support/mockSupabase'

const OTHER_ID = '33333333-3333-4333-8333-333333333333'

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

function statsTask(overrides: Partial<FakeTask> & { id: string; title: string }): FakeTask {
  return {
    space_id: FAKE_SPACE_ID,
    description: null,
    task_type: 'recurring',
    recurrence_mode: 'interval',
    // A wide interval by default, so an on-time/late fixture's few-day offset
    // never accidentally lands past a full cycle and wraps to "on time" via
    // cycleLateness() - tests that specifically want to exercise the wrap
    // pass their own tighter interval_days.
    interval_days: 30,
    weekly_days: null,
    end_condition: 'never',
    end_after_count: null,
    end_date: null,
    occurrences_completed: 1,
    points: 10,
    reminder_hour: 9,
    reminder_minute: 0,
    due_date: isoDaysFromToday(1),
    last_completed_date: isoDaysFromToday(0),
    last_completed_at: new Date().toISOString(),
    last_completed_by: [FAKE_USER_ID],
    last_completed_actor: FAKE_USER_ID,
    is_done: false,
    assigned_to: null,
    created_by: FAKE_USER_ID,
    created_at: new Date().toISOString(),
    starts_at: null,
    expires_at: null,
    reminder_policy: null,
    cancelled_at: null,
    expired_at: null,
    ...overrides,
  }
}

const HE_WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']
function weekdayOf(isoDate: string): string {
  return HE_WEEKDAYS[new Date(`${isoDate}T00:00:00Z`).getUTCDay()]
}

test.describe('stats screen', () => {
  test('a task credited to two people at once counts as done once, not twice', async ({ page }) => {
    const db = makeFakeDb({
      tasks: [
        {
          id: 'task-kitchen',
          space_id: FAKE_SPACE_ID,
          title: 'לנקות את המטבח',
          description: null,
          task_type: 'recurring',
          recurrence_mode: 'interval',
          interval_days: 1,
          weekly_days: null,
          end_condition: 'never',
          end_after_count: null,
          end_date: null,
          occurrences_completed: 1,
          points: 10,
          reminder_hour: 9,
          reminder_minute: 0,
          due_date: isoDaysFromToday(1),
          last_completed_date: isoDaysFromToday(0),
          last_completed_at: new Date().toISOString(),
          last_completed_by: [FAKE_USER_ID, OTHER_ID],
          last_completed_actor: FAKE_USER_ID,
          is_done: false,
          assigned_to: null,
          created_by: FAKE_USER_ID,
          created_at: new Date().toISOString(),
          starts_at: null,
          expires_at: null,
          reminder_policy: null,
          cancelled_at: null,
          expired_at: null,
        },
      ],
      otherPeople: [
        { id: OTHER_ID, display_name: 'דנה כהן', avatar_url: null, email: 'dana@example.com', lifetime_points: 10, spendable_points: 10 },
      ],
      taskCompletions: [
        {
          id: 'event-mine',
          task_id: 'task-kitchen',
          user_id: FAKE_USER_ID,
          points_awarded: 10,
          completed_on: isoDaysFromToday(0),
          created_at: new Date().toISOString(),
          completion_group: 'group-1',
        },
        {
          id: 'event-danas',
          task_id: 'task-kitchen',
          user_id: OTHER_ID,
          points_awarded: 10,
          completed_on: isoDaysFromToday(0),
          created_at: new Date().toISOString(),
          completion_group: 'group-1',
        },
      ],
    })
    await seed(page, db)
    await page.goto('/')
    await page.getByRole('button', { name: 'סטטיסטיקות' }).click()

    // One physical completion, done by two people together - not two.
    await expect(page.locator('.stat-tile', { hasText: 'מאז ומתמיד' }).locator('.points-value')).toHaveText('1')
    await expect(page.locator('.card', { hasText: 'המשימה שהושלמה הכי הרבה' })).toContainText('משימה אחת הושלמה')

    // Each participant still personally shows one completion and their own
    // points - the fix is about the shared event, not personal credit.
    const leaderboard = page.locator('.leaderboard-row')
    await expect(leaderboard).toHaveCount(2)
    await expect(leaderboard.filter({ hasText: 'אני' })).toContainText('משימה אחת הושלמה')
    await expect(leaderboard.filter({ hasText: 'דנה' })).toContainText('משימה אחת הושלמה')

    // Each did one of the two personal completions that went into the
    // household's total - an even 50/50 contribution split.
    await expect(leaderboard.filter({ hasText: 'אני' }).locator('.contribution-share')).toHaveText('50%')
    await expect(leaderboard.filter({ hasText: 'דנה' }).locator('.contribution-share')).toHaveText('50%')
  })

  test('two separate completions of the same task count as two', async ({ page }) => {
    const db = makeFakeDb({
      tasks: [
        {
          id: 'task-kitchen',
          space_id: FAKE_SPACE_ID,
          title: 'לנקות את המטבח',
          description: null,
          task_type: 'recurring',
          recurrence_mode: 'interval',
          interval_days: 1,
          weekly_days: null,
          end_condition: 'never',
          end_after_count: null,
          end_date: null,
          occurrences_completed: 2,
          points: 10,
          reminder_hour: 9,
          reminder_minute: 0,
          due_date: isoDaysFromToday(1),
          last_completed_date: isoDaysFromToday(0),
          last_completed_at: new Date().toISOString(),
          last_completed_by: [FAKE_USER_ID],
          last_completed_actor: FAKE_USER_ID,
          is_done: false,
          assigned_to: null,
          created_by: FAKE_USER_ID,
          created_at: new Date().toISOString(),
          starts_at: null,
          expires_at: null,
          reminder_policy: null,
          cancelled_at: null,
          expired_at: null,
        },
      ],
      taskCompletions: [
        {
          id: 'event-1',
          task_id: 'task-kitchen',
          user_id: FAKE_USER_ID,
          points_awarded: 10,
          completed_on: isoDaysFromToday(-1),
          created_at: new Date(Date.now() - 86_400_000).toISOString(),
          completion_group: null,
        },
        {
          id: 'event-2',
          task_id: 'task-kitchen',
          user_id: FAKE_USER_ID,
          points_awarded: 10,
          completed_on: isoDaysFromToday(0),
          created_at: new Date().toISOString(),
          completion_group: null,
        },
      ],
    })
    await seed(page, db)
    await page.goto('/')
    await page.getByRole('button', { name: 'סטטיסטיקות' }).click()

    await expect(page.locator('.stat-tile', { hasText: 'מאז ומתמיד' }).locator('.points-value')).toHaveText('2')
  })

  test('the contribution share is weighted by points, not task count', async ({ page }) => {
    // Test does one hard task worth 30 points; Dana does three easy ones
    // worth 10 each - the same 30 points, from three separate completions.
    // By count that would read 25%/75%; by points it must read 50%/50%.
    const db = makeFakeDb({
      tasks: [
        {
          id: 'task-hard',
          space_id: FAKE_SPACE_ID,
          title: 'לנקות את הגראז',
          description: null,
          task_type: 'one_time',
          recurrence_mode: null,
          interval_days: null,
          weekly_days: null,
          end_condition: 'never',
          end_after_count: null,
          end_date: null,
          occurrences_completed: 1,
          points: 30,
          reminder_hour: 9,
          reminder_minute: 0,
          due_date: isoDaysFromToday(1),
          last_completed_date: isoDaysFromToday(0),
          last_completed_at: new Date().toISOString(),
          last_completed_by: [FAKE_USER_ID],
          last_completed_actor: FAKE_USER_ID,
          is_done: true,
          assigned_to: null,
          created_by: FAKE_USER_ID,
          created_at: new Date().toISOString(),
          starts_at: null,
          expires_at: null,
          reminder_policy: null,
          cancelled_at: null,
          expired_at: null,
        },
        {
          id: 'task-easy',
          space_id: FAKE_SPACE_ID,
          title: 'לקפל כביסה',
          description: null,
          task_type: 'recurring',
          recurrence_mode: 'interval',
          interval_days: 1,
          weekly_days: null,
          end_condition: 'never',
          end_after_count: null,
          end_date: null,
          occurrences_completed: 3,
          points: 10,
          reminder_hour: 9,
          reminder_minute: 0,
          due_date: isoDaysFromToday(1),
          last_completed_date: isoDaysFromToday(0),
          last_completed_at: new Date().toISOString(),
          last_completed_by: [OTHER_ID],
          last_completed_actor: OTHER_ID,
          is_done: false,
          assigned_to: null,
          created_by: FAKE_USER_ID,
          created_at: new Date().toISOString(),
          starts_at: null,
          expires_at: null,
          reminder_policy: null,
          cancelled_at: null,
          expired_at: null,
        },
      ],
      otherPeople: [
        { id: OTHER_ID, display_name: 'דנה כהן', avatar_url: null, email: 'dana@example.com', lifetime_points: 30, spendable_points: 30 },
      ],
      taskCompletions: [
        {
          id: 'e-hard',
          task_id: 'task-hard',
          user_id: FAKE_USER_ID,
          points_awarded: 30,
          completed_on: isoDaysFromToday(0),
          created_at: new Date().toISOString(),
          completion_group: null,
        },
        {
          id: 'e-easy-1',
          task_id: 'task-easy',
          user_id: OTHER_ID,
          points_awarded: 10,
          completed_on: isoDaysFromToday(-2),
          created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
          completion_group: null,
        },
        {
          id: 'e-easy-2',
          task_id: 'task-easy',
          user_id: OTHER_ID,
          points_awarded: 10,
          completed_on: isoDaysFromToday(-1),
          created_at: new Date(Date.now() - 86_400_000).toISOString(),
          completion_group: null,
        },
        {
          id: 'e-easy-3',
          task_id: 'task-easy',
          user_id: OTHER_ID,
          points_awarded: 10,
          completed_on: isoDaysFromToday(0),
          created_at: new Date().toISOString(),
          completion_group: null,
        },
      ],
    })
    await seed(page, db)
    await page.goto('/')
    await page.getByRole('button', { name: 'סטטיסטיקות' }).click()

    const leaderboard = page.locator('.leaderboard-row')
    await expect(leaderboard.filter({ hasText: 'אני' }).locator('.contribution-share')).toHaveText('50%')
    await expect(leaderboard.filter({ hasText: 'דנה' }).locator('.contribution-share')).toHaveText('50%')
  })

  test('tapping a person opens a table of every task they completed, times, and points', async ({ page }) => {
    const db = makeFakeDb({
      tasks: [
        {
          id: 'task-easy', space_id: FAKE_SPACE_ID, title: 'לקפל כביסה', description: null,
          task_type: 'recurring', recurrence_mode: 'interval', interval_days: 1, weekly_days: null,
          end_condition: 'never', end_after_count: null, end_date: null, occurrences_completed: 3,
          points: 10, reminder_hour: 9, reminder_minute: 0, due_date: isoDaysFromToday(1),
          last_completed_date: isoDaysFromToday(0), last_completed_at: new Date().toISOString(),
          last_completed_by: [FAKE_USER_ID], last_completed_actor: FAKE_USER_ID,
          is_done: false, assigned_to: null, created_by: FAKE_USER_ID, created_at: new Date().toISOString(),
          starts_at: null, expires_at: null, reminder_policy: null, cancelled_at: null, expired_at: null,
        },
        {
          id: 'task-hard', space_id: FAKE_SPACE_ID, title: 'לנקות את הגראז', description: null,
          task_type: 'one_time', recurrence_mode: null, interval_days: null, weekly_days: null,
          end_condition: 'never', end_after_count: null, end_date: null, occurrences_completed: 1,
          points: 25, reminder_hour: 9, reminder_minute: 0, due_date: isoDaysFromToday(1),
          last_completed_date: isoDaysFromToday(0), last_completed_at: new Date().toISOString(),
          last_completed_by: [FAKE_USER_ID], last_completed_actor: FAKE_USER_ID,
          is_done: true, assigned_to: null, created_by: FAKE_USER_ID, created_at: new Date().toISOString(),
          starts_at: null, expires_at: null, reminder_policy: null, cancelled_at: null, expired_at: null,
        },
      ],
      taskCompletions: [
        { id: 'e-1', task_id: 'task-easy', user_id: FAKE_USER_ID, points_awarded: 10, completed_on: isoDaysFromToday(-2), created_at: '2026-01-01T08:00:00.000Z', completion_group: null },
        { id: 'e-2', task_id: 'task-easy', user_id: FAKE_USER_ID, points_awarded: 10, completed_on: isoDaysFromToday(-1), created_at: '2026-01-02T08:00:00.000Z', completion_group: null },
        { id: 'e-3', task_id: 'task-easy', user_id: FAKE_USER_ID, points_awarded: 10, completed_on: isoDaysFromToday(0), created_at: '2026-01-03T08:00:00.000Z', completion_group: null },
        { id: 'e-4', task_id: 'task-hard', user_id: FAKE_USER_ID, points_awarded: 25, completed_on: isoDaysFromToday(0), created_at: '2026-01-04T08:00:00.000Z', completion_group: null },
      ],
    })
    await seed(page, db)
    await page.goto('/')
    await page.getByRole('button', { name: 'סטטיסטיקות' }).click()

    await page.locator('.leaderboard-row', { hasText: 'אני' }).getByRole('button').click()

    const sheet = page.locator('.sheet', { hasText: 'אני' })
    await expect(sheet).toBeVisible()

    // Sorted by points, highest first: the recurring task's 3 x 10 = 30
    // outranks the one-time task's single 25.
    const laundryRow = sheet.locator('.stats-breakdown-summary', { hasText: 'לקפל כביסה' })
    const garageRow = sheet.locator('.stats-breakdown-summary', { hasText: 'לנקות את הגראז' })
    await expect(laundryRow).toContainText('3')
    await expect(laundryRow).toContainText('30')
    await expect(garageRow).toContainText('1')
    await expect(garageRow).toContainText('25')

    // No plain-text "X tasks completed" sentence - just the numbers.
    await expect(sheet).not.toContainText('הושלמו')

    // The total row sums both tasks.
    const totalRow = sheet.locator('.stats-breakdown-total')
    await expect(totalRow).toContainText('4')
    await expect(totalRow).toContainText('55')

    // The exact dates are hidden until that row is expanded.
    const laundryDates = sheet.locator('.stats-breakdown-details', { hasText: 'לקפל כביסה' }).locator('.history-row')
    await expect(laundryDates.first()).not.toBeVisible()
    await laundryRow.click()
    await expect(laundryDates).toHaveCount(3)
    await expect(laundryDates.first()).toBeVisible()
  })

  test('shows the weekly trend as a simple table of the last 6 weeks', async ({ page }) => {
    const db = makeFakeDb({
      tasks: [statsTask({ id: 'task-a', title: 'לנקות את המטבח' })],
      taskCompletions: [
        { id: 'e-this-week', task_id: 'task-a', user_id: FAKE_USER_ID, points_awarded: 10, completed_on: isoDaysFromToday(0), created_at: new Date().toISOString(), completion_group: null },
        { id: 'e-last-week', task_id: 'task-a', user_id: FAKE_USER_ID, points_awarded: 10, completed_on: isoDaysFromToday(-8), created_at: new Date(Date.now() - 8 * 86_400_000).toISOString(), completion_group: null },
      ],
    })
    await seed(page, db)
    await page.goto('/')
    await page.getByRole('button', { name: 'סטטיסטיקות' }).click()

    const card = page.locator('.card', { hasText: 'מגמה שבועית' })
    await expect(card.locator('.stats-breakdown-row', { hasText: 'השבוע' })).toContainText('1')
    await expect(card.locator('.stats-breakdown-row', { hasText: 'לפני שבוע' })).toContainText('1')
  })

  test('the on-time tile reflects completions before vs after the task\'s own due date', async ({ page }) => {
    const db = makeFakeDb({
      tasks: [statsTask({ id: 'task-a', title: 'להוציא זבל' })],
      taskCompletions: [
        {
          id: 'e-ontime', task_id: 'task-a', user_id: FAKE_USER_ID, points_awarded: 10,
          completed_on: isoDaysFromToday(0), created_at: new Date().toISOString(), completion_group: null,
          prev_due_date: isoDaysFromToday(0),
        },
        {
          id: 'e-late', task_id: 'task-a', user_id: FAKE_USER_ID, points_awarded: 10,
          completed_on: isoDaysFromToday(-1), created_at: new Date(Date.now() - 86_400_000).toISOString(), completion_group: null,
          prev_due_date: isoDaysFromToday(-4),
        },
      ],
    })
    await seed(page, db)
    await page.goto('/')
    await page.getByRole('button', { name: 'סטטיסטיקות' }).click()

    await expect(page.locator('.stat-tile', { hasText: 'בזמן' }).locator('.points-value')).toHaveText('50%')
  })

  test('the on-time tile wraps a recurring task\'s lateness to its own cycle', async ({ page }) => {
    // A dishwasher every 2 days: one completion exactly one full cycle late
    // (nothing was actually neglected) and one half a cycle into the next -
    // that reads as 50% on time, not 0%.
    const db = makeFakeDb({
      tasks: [statsTask({ id: 'task-a', title: 'להכניס מדיח', interval_days: 2 })],
      taskCompletions: [
        {
          id: 'e-full-cycle', task_id: 'task-a', user_id: FAKE_USER_ID, points_awarded: 10,
          completed_on: isoDaysFromToday(0), created_at: new Date().toISOString(), completion_group: null,
          prev_due_date: isoDaysFromToday(-2), // exactly one 2-day cycle late: on time
        },
        {
          id: 'e-half-cycle', task_id: 'task-a', user_id: FAKE_USER_ID, points_awarded: 10,
          completed_on: isoDaysFromToday(-1), created_at: new Date(Date.now() - 86_400_000).toISOString(), completion_group: null,
          prev_due_date: isoDaysFromToday(-6), // 5 days late on a 2-day cycle: half a cycle late
        },
      ],
    })
    await seed(page, db)
    await page.goto('/')
    await page.getByRole('button', { name: 'סטטיסטיקות' }).click()

    await expect(page.locator('.stat-tile', { hasText: 'בזמן' }).locator('.points-value')).toHaveText('50%')
  })

  test('flags the most neglected task - repeatedly late, not a single unlucky day', async ({ page }) => {
    const db = makeFakeDb({
      tasks: [
        statsTask({ id: 'task-neglected', title: 'לנקות את הגינה' }),
        statsTask({ id: 'task-once-late', title: 'לצחצח נעליים' }),
      ],
      taskCompletions: [
        // Repeatedly late - averages 3 days late across two completions.
        {
          id: 'e-1', task_id: 'task-neglected', user_id: FAKE_USER_ID, points_awarded: 10,
          completed_on: isoDaysFromToday(0), created_at: new Date().toISOString(), completion_group: null,
          prev_due_date: isoDaysFromToday(-2),
        },
        {
          id: 'e-2', task_id: 'task-neglected', user_id: FAKE_USER_ID, points_awarded: 10,
          completed_on: isoDaysFromToday(-5), created_at: new Date(Date.now() - 5 * 86_400_000).toISOString(), completion_group: null,
          prev_due_date: isoDaysFromToday(-9),
        },
        // Late exactly once - a single unlucky day should not count as a pattern.
        {
          id: 'e-3', task_id: 'task-once-late', user_id: FAKE_USER_ID, points_awarded: 10,
          completed_on: isoDaysFromToday(0), created_at: new Date().toISOString(), completion_group: null,
          prev_due_date: isoDaysFromToday(-10),
        },
      ],
    })
    await seed(page, db)
    await page.goto('/')
    await page.getByRole('button', { name: 'סטטיסטיקות' }).click()

    const card = page.locator('.card', { hasText: 'המשימה הכי מוזנחת' })
    await expect(card).toContainText('לנקות את הגינה')
    await expect(card).not.toContainText('לצחצח נעליים')
  })

  test('does not flag a task whose completions only ever missed one cycle, not the pattern of neglect', async ({ page }) => {
    // Two completions, each landing exactly one interval late - by the wrap
    // rule neither one was actually neglected, so this task must not show up
    // as the most neglected one even though the raw gap looks large.
    const db = makeFakeDb({
      tasks: [statsTask({ id: 'task-cyclic', title: 'להוציא זבל', interval_days: 3 })],
      taskCompletions: [
        {
          id: 'e-1', task_id: 'task-cyclic', user_id: FAKE_USER_ID, points_awarded: 10,
          completed_on: isoDaysFromToday(0), created_at: new Date().toISOString(), completion_group: null,
          prev_due_date: isoDaysFromToday(-3),
        },
        {
          id: 'e-2', task_id: 'task-cyclic', user_id: FAKE_USER_ID, points_awarded: 10,
          completed_on: isoDaysFromToday(-10), created_at: new Date(Date.now() - 10 * 86_400_000).toISOString(), completion_group: null,
          prev_due_date: isoDaysFromToday(-13),
        },
      ],
    })
    await seed(page, db)
    await page.goto('/')
    await page.getByRole('button', { name: 'סטטיסטיקות' }).click()

    await expect(page.locator('.card', { hasText: 'המשימה הכי מוזנחת' })).toHaveCount(0)
  })

  test('shows the busiest day of the week across all history', async ({ page }) => {
    const busyDate1 = '2026-01-08'
    const busyDate2 = '2026-01-15' // exactly 7 days later - guaranteed the same weekday
    const quietDate = '2026-01-10' // a different weekday, only one completion
    const db = makeFakeDb({
      tasks: [statsTask({ id: 'task-a', title: 'לקפל כביסה' })],
      taskCompletions: [
        { id: 'e-1', task_id: 'task-a', user_id: FAKE_USER_ID, points_awarded: 10, completed_on: busyDate1, created_at: `${busyDate1}T08:00:00.000Z`, completion_group: null },
        { id: 'e-2', task_id: 'task-a', user_id: FAKE_USER_ID, points_awarded: 10, completed_on: busyDate2, created_at: `${busyDate2}T08:00:00.000Z`, completion_group: null },
        { id: 'e-3', task_id: 'task-a', user_id: FAKE_USER_ID, points_awarded: 10, completed_on: quietDate, created_at: `${quietDate}T08:00:00.000Z`, completion_group: null },
      ],
    })
    await seed(page, db)
    await page.goto('/')
    await page.getByRole('button', { name: 'סטטיסטיקות' }).click()

    const card = page.locator('.card', { hasText: 'היום העמוס בשבוע' })
    await expect(card).toContainText(weekdayOf(busyDate1))
  })

  test('flags a space member who has never completed anything', async ({ page }) => {
    const db = makeFakeDb({
      tasks: [statsTask({ id: 'task-a', title: 'לשטוף כלים' })],
      taskCompletions: [
        { id: 'e-1', task_id: 'task-a', user_id: FAKE_USER_ID, points_awarded: 10, completed_on: isoDaysFromToday(0), created_at: new Date().toISOString(), completion_group: null },
      ],
      otherPeople: [
        { id: OTHER_ID, display_name: 'דנה כהן', avatar_url: null, email: 'dana@example.com', lifetime_points: 0, spendable_points: 0 },
      ],
    })
    await seed(page, db)
    await page.goto('/')
    await page.getByRole('button', { name: 'סטטיסטיקות' }).click()

    const card = page.locator('.card', { hasText: 'לא היה פעיל לאחרונה' })
    await expect(card).toBeVisible()
    const danaRow = card.locator('.history-row', { hasText: 'דנה' })
    await expect(danaRow).toContainText('אף משימה לא בוצעה עדיין')
    // The active user did complete something recently - not listed here.
    await expect(card.locator('.history-row', { hasText: 'אני' })).toHaveCount(0)
  })
})
