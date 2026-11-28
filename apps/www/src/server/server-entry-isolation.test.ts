import { fileURLToPath } from 'node:url'

import { Predicate } from 'effect'
import { createServer } from 'vite'
import { afterEach, expect, test, vi } from 'vitest'

afterEach(() => vi.unstubAllEnvs())

test('enabled server telemetry does not initialize the browser bootstrap during native SSR import', async () => {
  vi.stubEnv('SENTRY_UPLOAD_SOURCEMAPS', 'false')
  vi.stubEnv('VITE_SENTRY_ENABLED', 'true')
  vi.stubEnv('VITE_PUBLIC_SENTRY_DSN', 'https://abc123@telemetry.invalid/123')
  vi.stubEnv('VITE_SENTRY_RELEASE', 'gbfm-www@0000000000000000000000000000000000000000')

  const server = await createServer({
    root: fileURLToPath(new URL('../..', import.meta.url)),
    configFile: fileURLToPath(new URL('../../vite.config.ts', import.meta.url)),
    server: { middlewareMode: true, hmr: false, watch: null },
    logLevel: 'error',
  })

  try {
    const entry = await server.ssrLoadModule('/src/entry.effect.server.ts')
    expect(Predicate.isFunction(entry.renderPage)).toBe(true)
    const environment = server.environments.ssr

    if (!environment) throw new Error('Missing native SSR module environment')
    const modules = [...environment.moduleGraph.idToModuleMap.keys()]
    expect(modules.some((id) => id.endsWith('/src/app/navigation-events.ts'))).toBe(true)
    expect(modules.filter((id) => id.endsWith('/src/app/browser-runtime.ts'))).toEqual([])
    expect(modules.filter((id) => id.endsWith('/src/observability/sentry.ts'))).toEqual([])
  } finally {
    await server.close()
  }
}, 15_000)
