import { defineConfig } from '@playwright/test'

import base from '../../playwright.config'

export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: 'native-issuance.playwright.ts',
  outputDir: '../../test-results/native-issuance',
  webServer: undefined,
  use: {
    ...base.use,
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5183',
  },
})
