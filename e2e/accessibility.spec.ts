import { createRequire } from 'node:module'
import { expect, test, type Page } from '@playwright/test'
import { FAKE_SPACE_ID, FAKE_USER_ID, installSupabaseMock, makeFakeDb, seedSession, type FakeDb, type FakeTask } from './support/mockSupabase'

// Every screen, in both themes, through axe-core's WCAG 2.2 AA rules - and
// every control big enough to hit with a thumb. Contrast is the one that
// slips: a colour that reads fine in one theme can fail in the other, which
// is how white text on the dark theme's pale buttons went unnoticed.

const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js')
const DANA = { id: '33333333-3333-4333-8333-333333333333', display_name: 'דנה', avatar_url: null, email: 'dana@example.com', lifetime_points: 140, spendable_points: 60 }

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
    task_type: 'recurring', recurrence_mode: 'interval', interval_days: 7, weekly_days: null,
    end_condition: 'never', end_after_count: null, end_date: null, occurrences_completed: 0,
    points: 10, reminder_hour: 9, reminder_minute: 0, due_date: appToday(),
    last_completed_date: null, last_completed_at: null, last_completed_by: null, last_completed_actor: null,
    is_done: false, assigned_to: null, created_by: FAKE_USER_ID, created_at: new Date(Date.now() - 40 * 86_400_000).toISOString(),
    starts_at: null, expires_at: null, reminder_policy: null, cancelled_at: null, expired_at: null,
    ...overrides,
  }
}

/** A lived-in household: every badge, chip and group the screens can show. */
function household(): FakeDb {
  const completions: FakeDb['taskCompletions'] = []
  for (let i = 1; i <= 24; i++) {
    const day = shift(-i)
    completions.push({
      id: `c${i}`, task_id: i % 3 ? 't-dish' : 't-trash', user_id: i % 2 ? FAKE_USER_ID : DANA.id,
      points_awarded: 10, completed_on: day, created_at: `${day}T18:00:00Z`, completion_group: null,
      prev_due_date: i % 4 ? day : shift(-i - 2),
    })
  }
  completions.push({ id: 'c-today', task_id: 't-bath', user_id: FAKE_USER_ID, points_awarded: 15, completed_on: appToday(), created_at: new Date().toISOString(), completion_group: null })
  return makeFakeDb({
    profile: { id: FAKE_USER_ID, email: 'pini@example.com', display_name: 'פיני', avatar_url: null, timezone: 'Asia/Jerusalem', language: 'he', lifetime_points: 230, spendable_points: 85 },
    otherPeople: [DANA],
    tasks: [
      task('t-late', 'לנקות את התנור', { interval_days: 14, due_date: shift(-3) }),
      task('t-trash', 'להוציא את הזבל', { interval_days: 2, reminder_hour: 20 }),
      task('t-dish', 'לפרוק את המדיח', { interval_days: 1, reminder_hour: 8, assigned_to: FAKE_USER_ID }),
      task('t-bath', 'לנקות את חדר האמבטיה', { due_date: shift(7), last_completed_date: appToday(), last_completed_at: new Date().toISOString(), last_completed_by: [FAKE_USER_ID], last_completed_actor: FAKE_USER_ID, points: 15 }),
      task('t-laundry', 'לקפל כביסה', { due_date: shift(1), assigned_to: DANA.id }),
      task('t-gift', 'לקנות מתנה', { task_type: 'one_time', interval_days: null, due_date: shift(3) }),
    ],
    taskCompletions: completions,
    rewards: [
      { id: 'r1', space_id: FAKE_SPACE_ID, title: 'ערב סרט', description: null, cost: 50, created_by: FAKE_USER_ID, created_at: new Date().toISOString() },
      { id: 'r2', space_id: FAKE_SPACE_ID, title: 'ארוחת בוקר במיטה', description: null, cost: 120, created_by: DANA.id, created_at: new Date().toISOString() },
    ],
    redemptions: [
      { id: 'x1', space_id: FAKE_SPACE_ID, reward_id: 'r1', reward_title: 'ערב סרט', cost: 50, requested_by: DANA.id, approved_by: null, status: 'pending', requested_at: new Date().toISOString(), decided_at: null },
    ],
  })
}

async function open(page: Page, path: string, db: FakeDb = household()) {
  await seedSession(page)
  await page.addInitScript(() => window.localStorage.setItem('househero.language', 'he'))
  await installSupabaseMock(page, db)
  await page.goto(path)
  await expect(page.locator('.screen-header').first()).toBeVisible()
  // Let the cards' entrance animation finish: axe measures contrast on what
  // is painted, and a card mid-fade is lighter than it will be.
  await page.waitForTimeout(600)
}

async function axeViolations(page: Page) {
  await page.addScriptTag({ path: AXE })
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (context: Document, options: object) => Promise<{ violations: { id: string; help: string; nodes: { target: string[] }[] }[] }> } }).axe
    const result = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } })
    return result.violations.map((v) => `${v.id}: ${v.help} -> ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
  })
}

/** Controls smaller than 44x44 - the thumb-sized minimum on a phone. */
async function smallTargets(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('button, a[href], select, summary, input[type=checkbox], input[type=radio]'))
      .filter((el) => {
        const box = el.getBoundingClientRect()
        return box.width > 0 && box.height > 0 && (box.width < 44 || box.height < 44)
      })
      .map((el) => {
        const box = el.getBoundingClientRect()
        return `${(el.getAttribute('aria-label') || el.textContent || el.className).trim().slice(0, 40)} (${Math.round(box.width)}x${Math.round(box.height)})`
      }),
  )
}

const SCREENS = [
  ['today', '/'],
  ['tasks', '/?tab=tasks'],
  ['rewards', '/?tab=rewards'],
  ['stats', '/?tab=stats'],
  ['more', '/?tab=more'],
] as const

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: scheme })

    for (const [name, path] of SCREENS) {
      test(`the ${name} screen passes WCAG 2.2 AA and has thumb-sized controls`, async ({ page }) => {
        await open(page, path)
        expect(await axeViolations(page)).toEqual([])
        expect(await smallTargets(page)).toEqual([])
      })
    }

    for (const row of ['המרחב והחברים', 'חופשה', 'הזמנת אנשים', 'התראות', 'שפה', 'חשבון']) {
      test(`More › ${row} passes WCAG 2.2 AA and has thumb-sized controls`, async ({ page }) => {
        await open(page, '/?tab=more')
        await page.getByRole('button', { name: row }).click()
        await expect(page.getByRole('heading', { level: 1, name: row })).toBeVisible()
        await page.waitForTimeout(300)
        expect(await axeViolations(page)).toEqual([])
        expect(await smallTargets(page)).toEqual([])
      })
    }

    test('the weekly report passes WCAG 2.2 AA and has thumb-sized controls', async ({ page }) => {
      // With every part showing: a suggestion (the fridge, skipped five
      // weeks running) and a vacation note, on top of the usual household.
      const db = household()
      db.tasks.push(task('t-fridge', 'לנקות את המקרר', { interval_days: 7, due_date: shift(3), last_completed_date: null }))
      db.taskSkips = [4, 11, 18, 25, 32].map((back, i) => ({
        id: `s${i}`, task_id: 't-fridge', space_id: FAKE_SPACE_ID, user_id: FAKE_USER_ID, skipped_on: shift(-back), created_at: `${shift(-back)}T10:00:00Z`,
        prev_due_date: shift(-back), prev_last_skipped_date: null, prev_last_skipped_by: null, prev_is_done: false,
      }))
      db.pauses = [{ id: 'p1', space_id: FAKE_SPACE_ID, user_id: DANA.id, started_on: shift(-2), ended_on: shift(-1) }]
      await open(page, '/?tab=stats', db)
      await page.getByRole('button', { name: /הדוח השבועי/ }).click()
      await expect(page.getByRole('heading', { level: 1, name: 'הדוח השבועי' })).toBeVisible()
      await expect(page.locator('.card', { hasText: 'הצעה לשיפור' })).toBeVisible()
      await expect(page.locator('.report-away')).toBeVisible()
      await expect(page.locator('.report-outlook')).toBeVisible()
      await page.waitForTimeout(300)
      expect(await axeViolations(page)).toEqual([])
      expect(await smallTargets(page)).toEqual([])
    })

    test('the task details sheet passes WCAG 2.2 AA', async ({ page }) => {
      await open(page, '/')
      await page.locator('.task-card .task-main').first().click()
      await expect(page.locator('.sheet')).toBeVisible()
      await page.waitForTimeout(300)
      expect(await axeViolations(page)).toEqual([])
      expect(await smallTargets(page)).toEqual([])
    })

    test('the new-task form passes WCAG 2.2 AA', async ({ page }) => {
      await open(page, '/?tab=tasks')
      await page.locator('.fab').click()
      await expect(page.locator('.sheet')).toBeVisible()
      await page.waitForTimeout(300)
      expect(await axeViolations(page)).toEqual([])
      expect(await smallTargets(page)).toEqual([])
    })
  })
}
