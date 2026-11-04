import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: 'observability.spec.ts',
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:5191', trace: 'retain-on-failure' },
  projects: [
    {
      name: 'Chromium',
      use: {
        ...devices['Pixel 5'],
        launchOptions: { executablePath: process.env.CHROMIUM_PATH || undefined },
      },
    },
    { name: 'WebKit', use: { ...devices['iPhone 14 Pro'] } },
  ],
  webServer: {
    command: 'bunx vite --host 127.0.0.1 --port 5191 --strictPort',
    url: 'http://127.0.0.1:5191/@vite/client',
    env: {
      VITE_SENTRY_ENABLED: 'true',
      VITE_PUBLIC_SENTRY_DSN: 'https://abc123@o1.ingest.sentry.io/123',
      VITE_SENTRY_ENVIRONMENT: 'development',
      VITE_SENTRY_RELEASE: 'gbfm-www@0000000000000000000000000000000000000000',
    },
  },
})
