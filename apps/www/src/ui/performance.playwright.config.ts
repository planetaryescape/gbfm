import { fileURLToPath } from 'node:url'

import { defineConfig, devices } from '@playwright/test'

import performance from '../../playwright.rich-content.config'

export default defineConfig({
  ...performance,
  testDir: fileURLToPath(new URL('../../e2e/', import.meta.url)),
  outputDir: fileURLToPath(
    new URL('../../test-results/presentation-performance-mobile-chrome/', import.meta.url),
  ),
  reporter: 'list',
  workers: 1,
  retries: 0,
  use: {
    ...performance.use,
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5183',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'Mobile Chrome',
      use: {
        ...devices['Pixel 5'],
        colorScheme: 'dark',
        launchOptions: { executablePath: process.env.CHROMIUM_PATH || undefined },
      },
    },
  ],
})
