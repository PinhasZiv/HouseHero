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

function baseTask(overrides: { id: string; title: string; points: number }) {
  return {
    id: overrides.id,
    space_id: FAKE_SPACE_ID,
    title: overrides.title,
    description: null,
    task_type: 'one_time' as const,
    recurrence_mode: null,
    interval_days: null,
    weekly_days: null,
    end_condition: 'never' as const,
    end_after_count: null,
    end_date: null,
    occurrences_completed: 0,
    points: overrides.points,
    reminder_hour: 9,
    reminder_minute: 0,
    // Comfortably in the past regardless of which timezone "today" resolves
    // in - this test only cares that the task is not yet done, not which
    // due-today/overdue group it starts in.
    due_date: isoDaysFromToday(-2),
    last_completed_date: null,
    last_completed_at: null,
    last_completed_by: null,
    last_completed_actor: null,
    is_done: false,
    assigned_to: null,
    created_by: FAKE_USER_ID,
    created_at: new Date().toISOString(),
  }
}

test.describe('completing a task', () => {
  test('tapping Done opens a picker; choosing "I did it" awards its points and moves it into the completed group', async ({
    page,
  }) => {
    const db = makeFakeDb({
      tasks: [baseTask({ id: 'task-once', title: 'להרכיב את הארון', points: 25 })],
    })
    await seed(page, db)
    await page.goto('/')

    const card = page.locator('.task-card', { hasText: 'להרכיב את הארון' })
    await expect(card).toBeVisible()

    await card.getByRole('button', { name: /סימון .* כבוצעה/ }).click()

    // The "who did this?" picker opens rather than completing right away.
    // Alone in the space there is no segmented control to choose from - just
    // Confirm, defaulting to "I did it".
    await expect(page.getByRole('heading', { name: 'מי ביצע את זה?' })).toBeVisible()
    await page.getByRole('button', { name: 'אישור' }).click()

    // A toast confirms the points, and the task now sits in the collapsed
    // "בוצעו היום" section rather than the due list.
    await expect(page.getByText('+25 נקודות', { exact: false })).toBeVisible()
    const doneSection = page.locator('.completed-group', { hasText: 'בוצעו היום' })
    await expect(doneSection).toBeVisible()
    await doneSection.locator('summary').click()
    await expect(page.locator('.task-card', { hasText: 'להרכיב את הארון' })).toContainText('בוצעה על ידך')

    // The server actually recorded the completion and the points.
    expect(db.tasks[0].is_done).toBe(true)
    expect(db.profile.lifetime_points).toBe(25)
    expect(db.profile.spendable_points).toBe(25)

    // The same points show up from the Rewards screen too - one profile, not
    // a number that only the Today screen knows about.
    await page.getByRole('button', { name: 'תגמולים' }).click()
    await expect(page.locator('.points-value').first()).toHaveText('25')
  })

  test('cancelling the picker leaves the task untouched', async ({ page }) => {
    const db = makeFakeDb({
      tasks: [baseTask({ id: 'task-once', title: 'להרכיב את הארון', points: 25 })],
    })
    await seed(page, db)
    await page.goto('/')

    const card = page.locator('.task-card', { hasText: 'להרכיב את הארון' })
    await card.getByRole('button', { name: /סימון .* כבוצעה/ }).click()
    await expect(page.getByRole('heading', { name: 'מי ביצע את זה?' })).toBeVisible()

    await page.getByRole('button', { name: 'ביטול' }).click()

    await expect(page.getByRole('heading', { name: 'מי ביצע את זה?' })).not.toBeVisible()
    await expect(card.getByRole('button', { name: /סימון .* כבוצעה/ })).toBeVisible()
    expect(db.tasks[0].is_done).toBe(false)
    expect(db.taskCompletions.length).toBe(0)
  })

  test('selecting a segment only changes which option is active - nothing happens until Confirm', async ({ page }) => {
    const db = makeFakeDb({
      tasks: [baseTask({ id: 'task-once', title: 'לנקות את המטבח', points: 20 })],
      otherPeople: [
        { id: OTHER_ID, display_name: 'דנה כהן', avatar_url: null, email: 'dana@example.com', lifetime_points: 0, spendable_points: 0 },
      ],
    })
    await seed(page, db)
    await page.goto('/')

    const card = page.locator('.task-card', { hasText: 'לנקות את המטבח' })
    await card.getByRole('button', { name: /סימון .* כבוצעה/ }).click()
    const sheet = page.locator('.sheet', { hasText: 'מי ביצע את זה?' })

    await sheet.getByRole('tab', { name: 'כולם ביצעו יחד' }).click()
    await sheet.getByRole('tab', { name: 'אני ביצעתי' }).click()

    // Switching segments back and forth submitted nothing by itself - the
    // sheet is still open and no completion was recorded yet.
    await expect(sheet).toBeVisible()
    expect(db.tasks[0].is_done).toBe(false)
    expect(db.taskCompletions.length).toBe(0)
  })

  test('choosing "everyone did it together" credits every space member with the full points', async ({ page }) => {
    const db = makeFakeDb({
      tasks: [baseTask({ id: 'task-once', title: 'לנקות את המטבח', points: 20 })],
      otherPeople: [
        { id: OTHER_ID, display_name: 'דנה כהן', avatar_url: null, email: 'dana@example.com', lifetime_points: 0, spendable_points: 0 },
      ],
    })
    await seed(page, db)
    await page.goto('/')

    const card = page.locator('.task-card', { hasText: 'לנקות את המטבח' })
    await card.getByRole('button', { name: /סימון .* כבוצעה/ }).click()
    // Selecting the "everyone" segment only activates that option - nothing
    // happens until Confirm is tapped.
    const sheet = page.locator('.sheet', { hasText: 'מי ביצע את זה?' })
    await sheet.getByRole('tab', { name: 'כולם ביצעו יחד' }).click()
    await sheet.getByRole('button', { name: 'אישור' }).click()

    await expect(page.locator('.toast')).toContainText('+20 נק')
    await expect(page.locator('.task-card', { hasText: 'לנקות את המטבח' })).toContainText('בוצעה על ידי שני אנשים')

    // Every member got the full point value, not a split - and both rows
    // share one completion_group so history can show it as one event.
    expect(db.profile.lifetime_points).toBe(20)
    expect(db.profile.spendable_points).toBe(20)
    expect(db.otherPeople[0].lifetime_points).toBe(20)
    expect(db.otherPeople[0].spendable_points).toBe(20)
    expect(db.taskCompletions).toHaveLength(2)
    expect(db.taskCompletions[0].completion_group).not.toBeNull()
    expect(db.taskCompletions[0].completion_group).toBe(db.taskCompletions[1].completion_group)
    expect(db.tasks[0].last_completed_by).toEqual(expect.arrayContaining([FAKE_USER_ID, OTHER_ID]))
  })

  test('using the multi-select to credit just one specific person does not credit whoever tapped Done', async ({
    page,
  }) => {
    const db = makeFakeDb({
      tasks: [baseTask({ id: 'task-once', title: 'לקפל כביסה', points: 15 })],
      otherPeople: [
        { id: OTHER_ID, display_name: 'דנה כהן', avatar_url: null, email: 'dana@example.com', lifetime_points: 0, spendable_points: 0 },
      ],
    })
    await seed(page, db)
    await page.goto('/')

    const card = page.locator('.task-card', { hasText: 'לקפל כביסה' })
    await card.getByRole('button', { name: /סימון .* כבוצעה/ }).click()
    const sheet = page.locator('.sheet', { hasText: 'מי ביצע את זה?' })

    // The member checklist is not shown until the "custom" segment is chosen.
    await expect(sheet.getByRole('checkbox')).toHaveCount(0)
    await sheet.getByRole('tab', { name: 'בחירה מרובה' }).click()
    await expect(sheet.getByRole('checkbox')).toHaveCount(2)

    // The tapper is checked by default - uncheck them and check Dana instead.
    await sheet.getByRole('checkbox').nth(0).uncheck()
    await sheet.getByRole('checkbox').nth(1).check()
    await sheet.getByRole('button', { name: 'אישור' }).click()

    await expect(page.getByText('סומנה כבוצעה על ידי דנה', { exact: false })).toBeVisible()
    await expect(page.locator('.task-card', { hasText: 'לקפל כביסה' })).toContainText('בוצעה על ידי דנה')

    // Dana was credited, not the person who tapped the button.
    expect(db.profile.lifetime_points).toBe(0)
    expect(db.otherPeople[0].lifetime_points).toBe(15)
    expect(db.tasks[0].last_completed_by).toEqual([OTHER_ID])
  })

  test('multi-selecting several people credits exactly that subset', async ({ page }) => {
    const thirdId = '44444444-4444-4444-8444-444444444444'
    const db = makeFakeDb({
      tasks: [baseTask({ id: 'task-once', title: 'לסדר את הסלון', points: 12 })],
      otherPeople: [
        { id: OTHER_ID, display_name: 'דנה כהן', avatar_url: null, email: 'dana@example.com', lifetime_points: 0, spendable_points: 0 },
        { id: thirdId, display_name: 'יוסי לוי', avatar_url: null, email: 'yossi@example.com', lifetime_points: 0, spendable_points: 0 },
      ],
    })
    await seed(page, db)
    await page.goto('/')

    const card = page.locator('.task-card', { hasText: 'לסדר את הסלון' })
    await card.getByRole('button', { name: /סימון .* כבוצעה/ }).click()
    const sheet = page.locator('.sheet', { hasText: 'מי ביצע את זה?' })
    await sheet.getByRole('tab', { name: 'בחירה מרובה' }).click()

    // Keep the tapper checked (default) and additionally check Dana, leaving
    // Yossi unchecked.
    await sheet.getByRole('checkbox').nth(1).check()
    await sheet.getByRole('button', { name: 'אישור' }).click()

    await expect(page.locator('.toast')).toContainText('בוצעה על ידי שני אנשים')

    expect(db.profile.lifetime_points).toBe(12)
    expect(db.otherPeople.find((p) => p.id === OTHER_ID)?.lifetime_points).toBe(12)
    expect(db.otherPeople.find((p) => p.id === thirdId)?.lifetime_points).toBe(0)
    expect(db.tasks[0].last_completed_by).toEqual(expect.arrayContaining([FAKE_USER_ID, OTHER_ID]))
    expect(db.tasks[0].last_completed_by).toHaveLength(2)
  })
})
