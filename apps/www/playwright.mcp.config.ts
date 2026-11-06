import { defineConfig, devices } from '@playwright/test'

const frontend = 'https://gbfm-oauth-onboarding.localhost'

const api = 'https://gbfm-oauth-onboarding-api.localhost'

export default defineConfig({
  testDir: './e2e',
  testMatch: 'mcp-onboarding.spec.ts',
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  use: { baseURL: frontend, trace: 'off', video: 'off' },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } } },
    { name: 'tablet', use: { browserName: 'chromium', viewport: { width: 768, height: 1024 } } },
    { name: 'mobile-safari', use: { ...devices['iPhone 14 Pro'] } },
  ],
  webServer: [
    {
      command:
        'bunx portless gbfm-oauth-onboarding-api --app-port 3194 bun run --cwd ../server dev:mcp:e2e',
      url: `${api}/health`,
      env: { PORT: '3194', FRONTEND_URL: frontend, MCP_E2E_ISSUER: `${api}/auth` },
      gracefulShutdown: { signal: 'SIGTERM', timeout: 3000 },
    },
    {
      command:
        'bunx portless gbfm-oauth-onboarding --app-port 5194 bunx vite --host 127.0.0.1 --strictPort',
      url: `${frontend}/@vite/client`,
      env: { VPS_PROXY_TARGET: 'http://127.0.0.1:3194' },
      gracefulShutdown: { signal: 'SIGTERM', timeout: 3000 },
    },
  ],
})
