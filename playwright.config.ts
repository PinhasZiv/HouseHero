import { defineConfig, devices } from '@playwright/test'

// Runs against `vite dev` with a fake Supabase project so the suite never
// touches the real backend: VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY below
// point at a host that only exists inside each test's own page.route()
// mocks (see e2e/support/mockSupabase.ts), never a real API.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5184',
    trace: 'retain-on-failure',
    // Environments without a pre-fetched browser matching this exact
    // @playwright/test version still have a working Chromium at this fixed
    // path - use it instead of trying to download a new one.
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || '/opt/pw-browsers/chromium',
    },
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
