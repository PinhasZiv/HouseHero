import { expect, test } from '@playwright/test'
import { FAKE_SPACE_ID, FAKE_USER_ID, installSupabaseMock, makeFakeDb, seedSession, type FakeDb } from './support/mockSupabase'

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
          last_completed_by: [FAKE_USER_ID, OTHER_ID],
          last_completed_actor: FAKE_USER_ID,
          is_done: false,
          assigned_to: null,
          created_by: FAKE_USER_ID,
          created_at: new Date().toISOString(),
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
    await expect(page.locator('.card', { hasText: 'המשימה שהושלמה הכי הרבה' })).toContainText('משימה אחת הושלמו')

    // Each participant still personally shows one completion and their own
    // points - the fix is about the shared event, not personal credit.
    const leaderboard = page.locator('.leaderboard-row')
    await expect(leaderboard).toHaveCount(2)
    await expect(leaderboard.filter({ hasText: 'אני' })).toContainText('משימה אחת הושלמו')
    await expect(leaderboard.filter({ hasText: 'דנה' })).toContainText('משימה אחת הושלמו')

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
          last_completed_by: [FAKE_USER_ID],
          last_completed_actor: FAKE_USER_ID,
          is_done: false,
          assigned_to: null,
          created_by: FAKE_USER_ID,
          created_at: new Date().toISOString(),
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
})
