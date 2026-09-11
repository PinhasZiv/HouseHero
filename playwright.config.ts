import { existsSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'

// Runs against `vite dev` with a fake Supabase project so the suite never
// touches the real backend: VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY below
// point at a host that only exists inside each test's own page.route()
// mocks (see e2e/support/mockSupabase.ts), never a real API.

// Some sandboxes pre-install Chromium at this fixed path and pin it behind a
// symlink that always points at whatever revision is actually present -
// handy when the sandbox's browser predates the exact revision this
// @playwright/test version expects, since it sidesteps that version check
// entirely. It does not exist on a normal machine or a fresh GitHub Actions
// runner, where `npx playwright install` instead downloads the matching
// revision to Playwright's own cache - so this is only used when present.
const sandboxChromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH || '/opt/pw-browsers/chromium'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5184',
    trace: 'retain-on-failure',
    ...(existsSync(sandboxChromiumPath)
      ? { launchOptions: { executablePath: sandboxChromiumPath } }
      : {}),
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev -- --port 5184 --strictPort',
    url: 'http://localhost:5184',
    reuseExistingServer: !process.env.CI,
    env: {
      VITE_SUPABASE_URL: 'https://fake-project.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'fake-anon-key',
      VITE_VAPID_PUBLIC_KEY: 'BPplaceholder0000000000000000000000000000000000000000000000000000000000',
    },
  },
})
