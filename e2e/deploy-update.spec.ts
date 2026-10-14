import { createServer, type Server } from 'node:http'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { build } from 'vite'

// A deploy while a phone still holds the previous version used to leave a
// blank screen: GitHub Pages lets browsers reuse the page for 10 minutes, so
// the service worker's "network-first" fetch could get the old HTML back from
// the HTTP cache - while the new worker had already deleted the old version's
// files from the phone, and the deploy had removed them from the server.
//
// This builds real versions of the app and serves them the way GitHub Pages
// does (max-age=600 on everything, old files gone after a deploy), then walks
// through deploys between launches. It needs no Supabase: an unconfigured
// build still renders its setup screen, which is all "not blank" needs.

test.describe.configure({ mode: 'serial', timeout: 180_000 })

const PORT = 5199
const ORIGIN = `http://localhost:${PORT}`
const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

let root: string
let server: Server
const requests: string[] = []
/** Paths the server should fail once, to simulate a file that will not load. */
const failOnce = new Set<string>()

function deploy(version: string) {
  const live = join(root, 'live')
  rmSync(live, { recursive: true, force: true })
  cpSync(join(root, version), live, { recursive: true })
}

function statsChunk(version: string): string {
  return `/assets/${readdirSync(join(root, version, 'assets')).find((f) => /^StatsScreen-.*\.js$/.test(f))}`
}

function mainScript(version: string): string {
  return `/assets/${readdirSync(join(root, version, 'assets')).find((f) => /^index-.*\.js$/.test(f))}`
}

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'househero-deploy-'))
  // Three builds whose every file differs, the way consecutive deploys do.
  for (const version of ['A', 'B', 'C']) {
    await build({
      logLevel: 'silent',
      build: {
        outDir: join(root, version),
        emptyOutDir: true,
        rollupOptions: { output: { intro: `globalThis.__househeroBuild = '${version}';` } },
      },
    })
  }
  server = createServer((req, res) => {
    let path = decodeURIComponent(new URL(req.url ?? '/', ORIGIN).pathname)
    requests.push(path)
    if (path.endsWith('/')) path += 'index.html'
    const file = join(root, 'live', path)
    if (failOnce.delete(path)) {
      // A one-off failure (a dropped connection, say) - nothing to cache.
      res.writeHead(503, { 'Cache-Control': 'no-store' })
      res.end('unavailable')
      return
    }
    if (!existsSync(file)) {
      res.writeHead(404, { 'Cache-Control': 'max-age=600' })
      res.end('not found')
      return
    }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'max-age=600' })
    res.end(readFileSync(file))
  })
  await new Promise<void>((resolve) => server.listen(PORT, resolve))
})

test.afterAll(async () => {
  await new Promise((resolve) => server?.close(resolve))
  rmSync(root, { recursive: true, force: true })
})

/** A fresh launch of the app, the way a phone opens it from the home screen. */
async function launch(context: BrowserContext): Promise<Page> {
  const page = await context.newPage()
  await page.goto(`${ORIGIN}/`)
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
  return page
}

async function runningVersion(page: Page): Promise<string> {
  return page.evaluate(() => (globalThis as { __househeroBuild?: string }).__househeroBuild ?? '?')
}

async function rendered(page: Page): Promise<boolean> {
  await expect(page.locator('#root > *')).not.toHaveCount(0, { timeout: 10_000 })
  return true
}

/** Waits until the newest worker has activated - its cache in place. */
async function settle(page: Page, version: string) {
  const cacheName = readFileSync(join(root, version, 'sw.js'), 'utf8').match(/const CACHE = '([^']+)'/)?.[1]
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.update())
  // Activated, not just installed: nothing left installing or waiting.
  await expect
    .poll(() =>
      page.evaluate(async (name) => {
        const reg = await navigator.serviceWorker.getRegistration()
        const keys = await caches.keys()
        return keys.includes(name as string) && !reg?.installing && !reg?.waiting && reg?.active?.state === 'activated'
      }, cacheName),
    )
    .toBe(true)
}

async function freshContext(browser: Browser) {
  const context = await browser.newContext()
  const cdp = await context.newCDPSession(await context.newPage())
  return { context, clearHttpCache: () => cdp.send('Network.clearBrowserCache') }
}

test('after a deploy the app opens on the new version - never on a stale page with missing files', async ({ browser }) => {
  deploy('A')
  const { context, clearHttpCache } = await freshContext(browser)

  const first = await launch(context)
  await settle(first, 'A')
  await first.close()
  // Days go by: only the service worker's own cache still holds version A.
  await clearHttpCache()

  // Opened shortly before the deploy - its page now sits in the HTTP cache.
  const beforeDeploy = await launch(context)
  expect(await runningVersion(beforeDeploy)).toBe('A')
  await beforeDeploy.close()

  deploy('B')
  requests.length = 0
  const afterDeploy = await launch(context)
  // The page came from the server, not the HTTP cache - and it is the new one.
  expect(requests).toContain('/')
  expect(await rendered(afterDeploy)).toBe(true)
  expect(await runningVersion(afterDeploy)).toBe('B')
  await settle(afterDeploy, 'B')

  const again = await launch(context)
  expect(await rendered(again)).toBe(true)
  expect(await runningVersion(again)).toBe('B')
  await context.close()
})

test('a copy still open on the previous version can load its files after the deploy', async ({ browser }) => {
  deploy('A')
  const { context } = await freshContext(browser)
  const first = await launch(context)
  await settle(first, 'A')
  await first.close()
  // The worker only takes over after the first visit has loaded, so it is a
  // later launch that puts the app's files on the phone.
  const page = await launch(context)
  // Its files are on the phone - the Stats screen's too, fetched in the
  // background a couple of seconds after start.
  for (const file of [mainScript('A'), statsChunk('A')]) {
    await expect.poll(() => page.evaluate(async (path) => Boolean(await caches.match(path)), file)).toBe(true)
  }

  deploy('B')
  await settle(page, 'B')

  // Still running A, A's files gone from the server - but kept on the phone.
  expect(await runningVersion(page)).toBe('A')
  for (const file of [mainScript('A'), statsChunk('A')]) {
    expect(await page.evaluate(async (path) => (await fetch(path)).status, file)).toBe(200)
  }
  // This version's cache, the previous one, and the record of which is which.
  expect((await page.evaluate(() => caches.keys())).length).toBe(3)

  deploy('C')
  await settle(page, 'C')
  // Two deploys on, A's files are finally let go.
  expect(await page.evaluate(async (path) => Boolean(await caches.match(path)), statsChunk('A'))).toBe(false)
  await context.close()
})

test('a file that fails to load reloads the page once instead of leaving it blank', async ({ browser }) => {
  deploy('C')
  const context = await browser.newContext()
  const page = await context.newPage()
  failOnce.add(mainScript('C'))
  requests.length = 0

  await page.goto(`${ORIGIN}/`)
  expect(await rendered(page)).toBe(true)
  expect(requests.filter((path) => path === mainScript('C'))).toHaveLength(2)
  await context.close()
})
