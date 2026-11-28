import * as Cloudflare from '@alchemy.run/cloudflare'
import type * as Output from 'alchemy/Output'
import * as Effect from 'effect/Effect'
import type * as Redacted from 'effect/Redacted'

import { privateSourceMaps, workerObservability } from './observability'
import { hostname, localDevPorts, type StageConfig } from './stage'
import type { Storage } from './storage'

export const cdnRouter = (
  config: StageConfig,
  store: Storage,
  mediaPreviewKey: Output.Output<Redacted.Redacted>,
) =>
  Effect.gen(function* () {
    return yield* Cloudflare.Worker('CdnRouter', {
      main: './apps/cdn-router/src/index.ts',
      ...hostname(config, 'cdn.goosebumps.fm'),
      ...(config.isLocalDev ? { dev: { port: localDevPorts.cdn, strictPort: true } } : undefined),
      compatibility: { date: '2026-07-04' },
      build: privateSourceMaps,
      observability: workerObservability(config.isProduction),
      env: {
        APP_RELEASE: config.release,
        MEDIA_PREVIEW_KEY: mediaPreviewKey,
        MEDIA_PREVIEW_ORIGIN: config.isProduction
          ? 'https://goosebumps.fm,https://www.goosebumps.fm'
          : 'https://gbfm.localhost',
        USER_CONTENT: store.userContent,
        MIXES: store.mixes,
        IMAGES: Cloudflare.Images.Images('IMAGES'),
      },
    })
  })

export type CdnRouter = Effect.Success<ReturnType<typeof cdnRouter>>
