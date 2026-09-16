import { expect, test } from '@playwright/test'
import { FAKE_SPACE_ID, FAKE_USER_ID, installSupabaseMock, makeFakeDb, seedSession, type FakeDb } from './support/mockSupabase'

// Sort order (due date, then reminder time) and the collapsed "completed"
// section apply the same way on both the Today and Tasks screens - these
// tests exercise the ordering logic itself, not the completion flow (already
// covered by complete-task.spec.ts).

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

function task(overrides: Partial<{
  id: string
  title: string
  due_date: string
  reminder_hour: number
  reminder_minute: number
  is_done: boolean
  last_completed_date: string | null
  last_completed_at: string | null
}>) {
  return {
    id: overrides.id!,
    space_id: FAKE_SPACE_ID,
    title: overrides.title!,
    description: null,
    task_type: 'one_time' as const,
    recurrence_mode: null,
    interval_days: null,
    weekly_days: null,
    end_condition: 'never' as const,
    end_after_count: null,
    end_date: null,
    occurrences_completed: 0,
    points: 10,
    reminder_hour: overrides.reminder_hour ?? 9,
    reminder_minute: overrides.reminder_minute ?? 0,
    due_date: overrides.due_date!,
    last_completed_date: overrides.last_completed_date ?? null,
    last_completed_at: overrides.last_completed_at ?? null,
    last_completed_by: overrides.last_completed_date ? [FAKE_USER_ID] : null,
    last_completed_actor: overrides.last_completed_date ? FAKE_USER_ID : null,
    is_done: overrides.is_done ?? false,
    assigned_to: null,
    created_by: FAKE_USER_ID,
    created_at: new Date().toISOString(),
    starts_at: null,
    expires_at: null,
    reminder_policy: null,
    cancelled_at: null,
    expired_at: null,
  }
}

test.describe('task ordering', () => {
  test('the due-today group on the Today screen sorts by reminder time', async ({ page }) => {
    const db = makeFakeDb({
      tasks: [
        task({ id: 'evening', title: 'משימת ערב', due_date: isoDaysFromToday(0), reminder_hour: 20, reminder_minute: 0 }),
        task({ id: 'morning', title: 'משימת בוקר', due_date: isoDaysFromToday(0), reminder_hour: 7, reminder_minute: 30 }),
      ],
    })
    await seed(page, db)
    await page.goto('/')

    const dueGroup = page.locator('.task-group', { hasText: 'להיום' })
    const cards = dueGroup.locator('.task-card')
    await expect(cards).toHaveCount(2)
    await expect(cards.nth(0)).toContainText('משימת בוקר')
    await expect(cards.nth(1)).toContainText('משימת ערב')
  })

  test('the late group sorts oldest due date first', async ({ page }) => {
    const db = makeFakeDb({
      tasks: [
        task({ id: 'recent', title: 'איחור קל', due_date: isoDaysFromToday(-1) }),
        task({ id: 'old', title: 'איחור ותיק', due_date: isoDaysFromToday(-5) }),
      ],
    })
    await seed(page, db)
    await page.goto('/')

    const lateGroup = page.locator('.task-group', { hasText: 'באיחור' })
    const cards = lateGroup.locator('.task-card')
    await expect(cards).toHaveCount(2)
    await expect(cards.nth(0)).toContainText('איחור ותיק')
    await expect(cards.nth(1)).toContainText('איחור קל')
  })

  test('completed tasks are collapsed under "בוצעו היום" on the Today screen until expanded', async ({ page }) => {
    const db = makeFakeDb({
      tasks: [
        task({
          id: 'done-today',
          title: 'משימה שבוצעה',
          due_date: isoDaysFromToday(1),
          is_done: true,
          last_completed_date: isoDaysFromToday(0),
        }),
      ],
    })
    await seed(page, db)
    await page.goto('/')

    const doneCard = page.locator('.task-card', { hasText: 'משימה שבוצעה' })
    await expect(page.locator('.completed-group')).toBeVisible()
    await expect(doneCard).toBeHidden()

    await page.locator('.completed-group summary').click()
    await expect(doneCard).toBeVisible()
  })

  test('the Tasks screen sorts open tasks by due date and time, and moves completed tasks into a collapsed section sorted by completion time', async ({
    page,
  }) => {
    const db = makeFakeDb({
      tasks: [
        task({ id: 'open-later', title: 'פתוחה מאוחר יותר', due_date: isoDaysFromToday(3) }),
        task({ id: 'open-sooner', title: 'פתוחה בקרוב', due_date: isoDaysFromToday(1) }),
        task({
          id: 'done-earlier',
          title: 'בוצעה קודם',
          due_date: isoDaysFromToday(5),
          is_done: true,
          last_completed_date: isoDaysFromToday(0),
          last_completed_at: new Date(Date.now() - 60 * 60_000).toISOString(),
        }),
        task({
          id: 'done-later',
          title: 'בוצעה אחר כך',
          due_date: isoDaysFromToday(6),
          is_done: true,
          last_completed_date: isoDaysFromToday(0),
          last_completed_at: new Date().toISOString(),
        }),
      ],
    })
    await seed(page, db)
    await page.goto('/')
    await page.getByRole('button', { name: 'משימות' }).click()

    // Open tasks show up front, soonest due date first - the completed pair
    // is nowhere in this list even though one of them has an earlier due date
    // than either open task.
    const openCards = page.locator('.screen').locator('.task-group:not(.completed-group) .task-card')
    await expect(openCards).toHaveCount(2)
    await expect(openCards.nth(0)).toContainText('פתוחה בקרוב')
    await expect(openCards.nth(1)).toContainText('פתוחה מאוחר יותר')

    // The completed section is collapsed by default...
    const completedCards = page.locator('.completed-group .task-card')
    await expect(page.locator('.completed-group')).toContainText('משימות שבוצעו (2)')
    await expect(completedCards.first()).toBeHidden()

    // ...and once opened, is sorted by actual completion time, most recent
    // first - not by due date, which would have ordered these the other way.
    await page.locator('.completed-group summary').click()
    await expect(completedCards).toHaveCount(2)
    await expect(completedCards.nth(0)).toContainText('בוצעה אחר כך')
    await expect(completedCards.nth(1)).toContainText('בוצעה קודם')
  })
})
