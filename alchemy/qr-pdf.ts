import * as Cloudflare from '@alchemy.run/cloudflare'
import * as Output from 'alchemy/Output'
import * as Effect from 'effect/Effect'

import type { CdnRouter } from './cdn'
import { privateSourceMaps, workerObservability } from './observability'
import { localDevPorts, type StageConfig } from './stage'
import type { Storage } from './storage'

export const qrPdfWorker = (config: StageConfig, store: Storage, cdn: CdnRouter) =>
  Effect.gen(function* () {
    return yield* Cloudflare.Worker('QrPdf', {
      main: './apps/pdf-generator/src/worker.ts',
      workersDev: false,
      ...(config.isLocalDev ? { dev: { port: localDevPorts.qrPdf, strictPort: true } } : undefined),
      compatibility: { date: '2026-07-04' },
      build: privateSourceMaps,
      observability: workerObservability(config.isProduction),
      assets: {
        directory: './apps/pdf-generator/assets/fonts',
        runWorkerFirst: true,
        htmlHandling: 'none',
        notFoundHandling: 'none',
      },
      env: {
        APP_RELEASE: config.release,
        USER_CONTENT: store.userContent,
        CDN_ROUTER_URL: Output.map(cdn.url, (url) => url ?? ''),
      },
    })
  })

export type QrPdfWorker = Effect.Success<ReturnType<typeof qrPdfWorker>>
