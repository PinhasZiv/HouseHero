import { expect, test } from '@playwright/test'
import { installSupabaseMock, makeFakeDb, seedSession } from './support/mockSupabase'

// When the service worker cannot move a page to a tapped notification's task
// itself (the page was opened before the worker took over), it posts the URL
// to the page instead - see openApp() in public/sw.js.

async function postFromWorker(page: import('@playwright/test').Page, url: string) {
  await page.evaluate((target) => {
    ;(window as { __beforeTap?: boolean }).__beforeTap = true
    navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'open-url', url: target } }))
  }, url)
}

test.beforeEach(async ({ page }) => {
  await seedSession(page)
  await page.addInitScript(() => window.localStorage.setItem('househero.language', 'he'))
  await installSupabaseMock(page, makeFakeDb())
  await page.goto('/')
  await expect(page.locator('#root > *')).not.toHaveCount(0)
})

test("the page goes to the notification's link when the worker asks it to", async ({ page }) => {
  const target = new URL('/?tab=stats', page.url()).href
  await Promise.all([page.waitForEvent('framenavigated'), postFromWorker(page, target)])
  await expect.poll(() => page.evaluate(() => (window as { __beforeTap?: boolean }).__beforeTap ?? false)).toBe(false)
})

test('a link to anywhere outside the app is ignored', async ({ page }) => {
  const before = page.url()
  await postFromWorker(page, 'https://example.com/?tab=stats')
  await page.waitForTimeout(500)
  expect(page.url()).toBe(before)
  expect(await page.evaluate(() => (window as { __beforeTap?: boolean }).__beforeTap)).toBe(true)
})
