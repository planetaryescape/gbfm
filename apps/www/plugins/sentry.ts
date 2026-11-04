import { sentryVitePlugin } from '@sentry/vite-plugin'
import type { Plugin } from 'vite'

export const sentryBuildPlugins = (input: {
  readonly upload: boolean
  readonly token: string | undefined
  readonly release: string | undefined
}) => {
  if (!input.upload) return []

  if (!input.token) throw new Error('Sentry source-map upload requires SENTRY_AUTH_TOKEN')

  if (!/^gbfm-www@[a-f0-9]{40}$/.test(input.release ?? ''))
    throw new Error('Sentry source-map upload requires an immutable WWW release')

  return sentryVitePlugin({
    org: 'goosebumps-collective',
    project: 'gbfm-frontend',
    authToken: input.token,
    telemetry: false,
    release: { name: input.release, inject: false },
    sourcemaps: {
      assets: './dist/client/**',
      filesToDeleteAfterUpload: './dist/client/**/*.map',
    },
  }).map(
    (plugin) =>
      ({
        ...plugin,
        applyToEnvironment: (environment) => environment.name === 'client',
      }) satisfies Plugin,
  )
}
