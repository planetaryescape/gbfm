import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: 'hydration-textarea.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    ...devices['Pixel 5'],
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || undefined },
  },
  projects: [{ name: 'Mobile Chrome' }],
})
