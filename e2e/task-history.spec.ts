import { expect, test } from '@playwright/test'
import {
  FAKE_SPACE_ID,
  FAKE_USER_ID,
  installSupabaseMock,
  makeFakeDb,
  seedSession,
  type FakeDb,
} from './support/mockSupabase'

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

test.describe('task completion history', () => {
  test('shows who completed a task and when, and how many points it earned', async ({ page }) => {
    const db = makeFakeDb({
      tasks: [
        {
          id: 'task-dishes',
          space_id: FAKE_SPACE_ID,
          title: 'לשטוף כלים',
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
          last_completed_actor: null,
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
        {
          id: 'other-user-id',
          display_name: 'Dana Cohen',
          avatar_url: null,
          email: 'dana@example.com',
          lifetime_points: 40,
          spendable_points: 40,
        },
      ],
      taskCompletions: [
        {
          id: 'event-today',
          task_id: 'task-dishes',
          user_id: FAKE_USER_ID,
          points_awarded: 10,
          completed_on: isoDaysFromToday(0),
          created_at: new Date().toISOString(),
          completion_group: null,
        },
        {
          // Older than the "completed today" badge, which is exactly what
          // this feature exists to still show.
          id: 'event-last-week',
          task_id: 'task-dishes',
          user_id: 'other-user-id',
          points_awarded: 10,
          completed_on: isoDaysFromToday(-7),
          created_at: new Date(Date.now() - 7 * 86_400_000).toISOString(),
          completion_group: null,
        },
      ],
    })
    await seed(page, db)
    await page.goto('/')

    // Completed today, so it sits in the collapsed "completed" section.
    await page.locator('.completed-group summary').click()
    const card = page.locator('.task-card', { hasText: 'לשטוף כלים' })
    await expect(card).toBeVisible()
    await card.locator('.task-main').click()

    const sheet = page.locator('.sheet', { hasText: 'היסטוריית הביצוע' })
    await expect(sheet).toBeVisible()
    await expect(sheet.locator('.history-row', { hasText: 'בוצעה על ידך' })).toContainText('+10')
    await expect(sheet.locator('.history-row', { hasText: 'Dana' })).toContainText('+10')
    await sheet.getByRole('button', { name: 'סגירה' }).click()
    await expect(sheet).toBeHidden()

    // The pencil icon reaches the edit form; tapping the card body opened
    // history instead, exactly like on the Today screen.
    await page.getByRole('button', { name: 'משימות' }).click()
    await page.locator('.completed-group summary').click()
    const tasksCard = page.locator('.task-card', { hasText: 'לשטוף כלים' })
    await tasksCard.getByRole('button', { name: 'עריכת לשטוף כלים' }).click()
    await expect(page.locator('.sheet', { hasText: 'עריכת משימה' })).toBeVisible()
  })

  test('shows the task\'s description, schedule, reminder time and assignment - not just the edit form', async ({ page }) => {
    const db = makeFakeDb({
      tasks: [
        {
          id: 'task-plants',
          space_id: FAKE_SPACE_ID,
          title: 'להשקות צמחים',
          description: 'רק את העציצים בסלון, לא את הגינה.',
          task_type: 'recurring',
          recurrence_mode: 'interval',
          interval_days: 3,
          weekly_days: null,
          end_condition: 'after_count',
          end_after_count: 10,
          end_date: null,
          occurrences_completed: 2,
          points: 8,
          reminder_hour: 18,
          reminder_minute: 30,
          due_date: isoDaysFromToday(1),
          last_completed_date: null,
          last_completed_at: null,
          last_completed_by: null,
          last_completed_actor: null,
          is_done: false,
          assigned_to: FAKE_USER_ID,
          created_by: FAKE_USER_ID,
          created_at: new Date().toISOString(),
          starts_at: null,
          expires_at: null,
          reminder_policy: null,
          cancelled_at: null,
          expired_at: null,
        },
      ],
    })
    await seed(page, db)
    await page.goto('/')
    await page.getByRole('button', { name: 'משימות' }).click()

    await page.locator('.task-card', { hasText: 'להשקות צמחים' }).locator('.task-main').click()

    const sheet = page.locator('.sheet', { hasText: 'להשקות צמחים' })
    await expect(sheet).toBeVisible()
    await expect(sheet).toContainText('רק את העציצים בסלון')
    await expect(sheet).toContainText('8 נק')
    await expect(sheet).toContainText('כל 3 ימים')
    await expect(sheet).toContainText('18:30')
    await expect(sheet).toContainText('שייכת אליך')
    await expect(sheet).toContainText('אחרי 10 פעמים')
  })

  test('says so when a task has never been completed', async ({ page }) => {
    const db = makeFakeDb({
      tasks: [
        {
          id: 'task-trash',
          space_id: FAKE_SPACE_ID,
          title: 'להוציא זבל',
          description: null,
          task_type: 'recurring',
          recurrence_mode: 'interval',
          interval_days: 3,
          weekly_days: null,
          end_condition: 'never',
          end_after_count: null,
          end_date: null,
          occurrences_completed: 0,
          points: 5,
          reminder_hour: 9,
          reminder_minute: 0,
          due_date: isoDaysFromToday(2),
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
          reminder_policy: null,
          cancelled_at: null,
          expired_at: null,
        },
      ],
    })
    await seed(page, db)
    await page.goto('/')
    await page.getByRole('button', { name: 'משימות' }).click()

    await page.locator('.task-card', { hasText: 'להוציא זבל' }).locator('.task-main').click()
    await expect(page.getByText('עוד לא בוצעה אף פעם.')).toBeVisible()
  })

  test('collapses a multi-person completion into one entry instead of one row per person', async ({ page }) => {
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
          last_completed_by: [FAKE_USER_ID, 'other-user-id'],
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
        {
          id: 'other-user-id',
          display_name: 'Dana Cohen',
          avatar_url: null,
          email: 'dana@example.com',
          lifetime_points: 10,
          spendable_points: 10,
        },
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
          user_id: 'other-user-id',
          points_awarded: 10,
          completed_on: isoDaysFromToday(0),
          created_at: new Date().toISOString(),
          completion_group: 'group-1',
        },
      ],
    })
    await seed(page, db)
    await page.goto('/')

    // Completed today, so it sits in the collapsed "completed" section.
    await page.locator('.completed-group summary').click()
    const card = page.locator('.task-card', { hasText: 'לנקות את המטבח' })
    await card.locator('.task-main').click()

    const sheet = page.locator('.sheet', { hasText: 'היסטוריית הביצוע' })
    await expect(sheet).toBeVisible()
    // One entry for the whole event, not one per participant.
    await expect(sheet.locator('.history-row')).toHaveCount(1)
    await expect(sheet.locator('.history-row')).toContainText('בוצע יחד')
    await expect(sheet.locator('.history-row')).toContainText('שני אנשים')
    await expect(sheet.locator('.history-row')).toContainText('+10')
  })
})
