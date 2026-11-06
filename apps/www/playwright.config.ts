import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testIgnore: 'mcp-onboarding.spec.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  // Journeys share the fixture database and publish content read by other scenarios.
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
    video: process.env.RECORD_E2E ? 'on' : 'retain-on-failure',
    screenshot: 'only-on-failure',
    colorScheme: 'dark',
  },
  projects: [
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 14 Pro'] },
    },
    {
      name: 'Mobile Chrome',
      use: {
        ...devices['Pixel 5'],
        colorScheme: 'dark',
        launchOptions: {
          executablePath: process.env.CHROMIUM_PATH || undefined,
        },
      },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : [
        {
          command: 'PORT=3003 FRONTEND_URL=http://127.0.0.1:5173 bun run --cwd ../server dev:e2e',
          url: 'http://127.0.0.1:3003/health',
          reuseExistingServer: !process.env.CI,
        },
        {
          command:
            'TURNSTILE_SITE_KEY=1x00000000000000000000AA VITE_SPOTIFY_CLIENT_ID=gbfm-local-e2e bunx vite --host 127.0.0.1 --port 5173',
          url: 'http://127.0.0.1:5173',
          reuseExistingServer: !process.env.CI,
        },
      ],
})
