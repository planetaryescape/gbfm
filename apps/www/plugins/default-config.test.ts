import { fileURLToPath } from 'node:url'

import { loadConfigFromFile, resolveConfig } from 'vite'
import { afterEach, expect, test, vi } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))
const release = '0000000000000000000000000000000000000000'

afterEach(() => vi.unstubAllEnvs())

const config = async (filename: string, command: 'build' | 'serve' = 'build') => {
  const loaded = await loadConfigFromFile(
    { command, mode: 'production' },
    fileURLToPath(new URL(`../${filename}`, import.meta.url)),
  )

  if (!loaded) throw new Error('The default frontend build configuration must load')

  return resolveConfig({ ...loaded.config, configFile: false, root }, command, 'production')
}

test.each(['vite.config.ts', 'vite.effect.config.ts'])(
  '%s uses the native runtime without changing deployed output paths',
  async (filename) => {
    vi.stubEnv('SENTRY_UPLOAD_SOURCEMAPS', 'false')
    vi.stubEnv('APP_RELEASE', release)
    vi.stubEnv('GBFM_BUILD_ID', undefined)
    const resolved = await config(filename)

    expect(resolved.plugins.some((plugin) => plugin.name === 'gbfm:effect-ui')).toBe(true)
    expect(resolved.plugins.some((plugin) => /foldkit/i.test(plugin.name))).toBe(false)
    expect(resolved.environments.client?.build.outDir).toBe('dist/client')
    expect(resolved.environments.ssr?.build.outDir).toBe('dist/server')
    expect(resolved.build.sourcemap).toBe(false)
    expect(resolved.define?.['import.meta.env.GBFM_BUILD_ID']).toBe(JSON.stringify(release))
    expect(resolved.ssr.target).toBe('webworker')
    expect(resolved.ssr.noExternal).toBe(true)
    expect(resolved.environments.ssr?.resolve.conditions).toContain('workerd')
    expect(resolved.ssr.external).not.toContain('debug')
    expect(resolved.ssr.external).not.toContain('extend')
  },
)

test('source-map upload remains an explicit credential-gated build operation', async () => {
  vi.stubEnv('SENTRY_UPLOAD_SOURCEMAPS', 'true')
  vi.stubEnv('SENTRY_AUTH_TOKEN', undefined)
  vi.stubEnv('APP_RELEASE', release)
  await expect(config('vite.config.ts')).rejects.toThrow(
    'Sentry source-map upload requires SENTRY_AUTH_TOKEN',
  )
})

test('development keeps Node-only CommonJS compatibility out of the Worker build', async () => {
  vi.stubEnv('SENTRY_UPLOAD_SOURCEMAPS', 'false')
  const resolved = await config('vite.config.ts', 'serve')
  expect(resolved.ssr.external).toContain('debug')
  expect(resolved.ssr.external).toContain('extend')
  expect(resolved.environments.ssr?.keepProcessEnv).toBe(true)
  expect(resolved.environments.ssr?.resolve.builtins).toContain('node:async_hooks')
})
