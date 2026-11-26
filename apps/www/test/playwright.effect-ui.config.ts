import { fileURLToPath, URL } from 'node:url'

import { defineConfig, devices } from '@playwright/test'

const app = process.env.GBFM_EFFECT_APP === '1'

const baseURL = process.env.GBFM_EFFECT_PREVIEW_BASE ?? 'http://127.0.0.1:4175'

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
  webServer:
    process.env.CI === 'true'
      ? {
          command: `bun scripts/effect-ui-workerd.ts${app ? '' : ' --fixture'} --serve`,
          cwd: fileURLToPath(new URL('..', import.meta.url)),
          url: new URL(app ? '/about' : '/', baseURL).href,
          reuseExistingServer: false,
          env: { GBFM_EFFECT_PREVIEW_PORT: new URL(baseURL).port || '4175' },
        }
      : undefined,
})
