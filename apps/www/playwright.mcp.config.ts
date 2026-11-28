import { defineConfig, devices } from '@playwright/test'

const frontend = 'https://gbfm-oauth-onboarding.localhost'

const api = 'https://gbfm-oauth-onboarding-api.localhost'

const externalServers = process.env.MCP_EXTERNAL_SERVERS === '1'

const connections = process.env.MCP_CONNECTIONS_UI === '1'

const frontendEnv = {
  VPS_PROXY_TARGET: 'http://127.0.0.1:3194',
  EDITORIAL_OAUTH_ISSUER: `${api}/auth`,
  GBFM_FRONTEND_ORIGIN: frontend,
  VITE_SENTRY_ENABLED: 'false',
  SENTRY_UPLOAD_SOURCEMAPS: 'false',
}

export default defineConfig({
  testDir: './e2e',
  testMatch: connections ? 'mcp-connections.spec.ts' : 'mcp-onboarding.spec.ts',
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  use: { baseURL: frontend, trace: 'off', video: 'off', ignoreHTTPSErrors: true },
  projects: [
    {
      name: 'desktop',
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 800 },
        launchOptions: { executablePath: process.env.CHROMIUM_PATH },
      },
    },
    {
      name: 'tablet',
      use: {
        browserName: 'chromium',
        viewport: { width: 768, height: 1024 },
        launchOptions: { executablePath: process.env.CHROMIUM_PATH },
      },
    },
    { name: 'mobile-safari', use: { ...devices['iPhone 14 Pro'] } },
  ],
  webServer: externalServers
    ? undefined
    : [
        {
          command:
            'bunx portless gbfm-oauth-onboarding-api --app-port 3194 bun run --cwd ../server dev:mcp:e2e',
          url: `${api}/health`,
          env: { PORT: '3194', FRONTEND_URL: frontend, MCP_E2E_ISSUER: `${api}/auth` },
          gracefulShutdown: { signal: 'SIGTERM', timeout: 3000 },
        },
        {
          command:
            'bunx portless gbfm-oauth-onboarding --app-port 5194 bunx vite --config vite.mcp.effect.config.ts --host 127.0.0.1 --strictPort',
          url: `${frontend}/@vite/client`,
          env: frontendEnv,
          gracefulShutdown: { signal: 'SIGTERM', timeout: 3000 },
        },
      ],
})
