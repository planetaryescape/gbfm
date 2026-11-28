import { fileURLToPath, URL } from 'node:url'

import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test'

import { parseFixtureBase } from '../scripts/effect-ui-fixture-api'

const app = process.env.GBFM_EFFECT_APP === '1'

const baseURL = process.env.GBFM_EFFECT_PREVIEW_BASE ?? 'http://127.0.0.1:4175'

const preview = parseFixtureBase(baseURL)

if (!preview) throw new Error('Missing local native preview URL')

const managedServers = (): PlaywrightTestConfig['webServer'] => {
  if (process.env.CI !== 'true') return undefined

  const frontend = {
    command: `bun scripts/effect-ui-workerd.ts${app ? '' : ' --fixture'} --serve`,
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    url: new URL(app ? '/about' : '/', preview).href,
    reuseExistingServer: false,
    env: { GBFM_EFFECT_PREVIEW_PORT: preview.port },
  }

  if (process.env.GBFM_EFFECT_E2E_FIXTURE !== '1') return frontend
  const fixture = parseFixtureBase(process.env.GBFM_FRONTEND_FIXTURE_BASE)

  if (!app || !fixture || fixture.hostname !== '127.0.0.1' || fixture.port !== '3013')
    throw new Error(
      'Managed E2E fixtures require GBFM_EFFECT_APP=1 and GBFM_FRONTEND_FIXTURE_BASE=http://127.0.0.1:3013',
    )

  if (fixture.port === preview.port)
    throw new Error('The native frontend and E2E fixture must use separate ports')

  return [
    {
      command: 'bun run dev:e2e',
      cwd: fileURLToPath(new URL('../../server/', import.meta.url)),
      url: new URL('/health', fixture).href,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        PORT: fixture.port,
        FRONTEND_URL: preview.origin,
        BETTER_AUTH_URL: fixture.origin,
        BETTER_AUTH_SECRET: 'local-e2e-secret-at-least-32-characters',
      },
    },
    {
      ...frontend,
      env: { ...frontend.env, GBFM_FRONTEND_FIXTURE_BASE: fixture.origin },
    },
  ]
}

export default defineConfig({
  testDir: '.',
  testMatch: app ? 'effect-ui.app.browser.spec.ts' : 'effect-ui.browser.spec.ts',
  outputDir: '../test-results/effect-ui',
  reporter: 'list',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'Chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { executablePath: process.env.CHROMIUM_PATH || undefined },
      },
    },
  ],
  webServer: managedServers(),
})
