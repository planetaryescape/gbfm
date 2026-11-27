import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: '../e2e',
  testMatch: 'dashboard-retirement-dom.spec.ts',
  timeout: 15_000,
  expect: { timeout: 5_000 },
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  outputDir: '../../../.git/dashboard-retirement-playwright',
  use: {
    actionTimeout: 5_000,
    serviceWorkers: 'block',
    launchOptions: { executablePath: process.env.CHROMIUM_PATH },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 900, height: 700 } },
    },
  ],
})
