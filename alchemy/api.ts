import * as Cloudflare from 'alchemy/Cloudflare'
import * as Output from 'alchemy/Output'
import * as Effect from 'effect/Effect'
import type * as Redacted from 'effect/Redacted'

import type { NavigationLockDurableObject } from '../apps/server/src/durable-objects/navigation-lock.do'
import type { SpotifyImportResolverDurableObject } from '../apps/server/src/durable-objects/spotify-import-resolver.do'
import type { EmailDeploymentConfig } from '../apps/server/src/email-deployment-config'
import {
  maintenanceSweepCron,
  reminderSweepCron,
  sitemapRegenerationCron,
} from '../apps/server/src/scheduled'
import type { CdnRouter } from './cdn'
import type { EmailResources } from './email'
import { privateSourceMaps, workerObservability } from './observability'
import type { QrPdfWorker } from './qr-pdf'
import type { SecretBindings } from './secrets'
import { hostname, localDevPorts, type StageConfig } from './stage'
import type { Storage } from './storage'

export interface ApiWorkerInput {
  readonly config: StageConfig
  readonly store: Storage
  readonly secrets: SecretBindings
  readonly email: EmailResources
  readonly emailConfig: EmailDeploymentConfig
  readonly cdn: CdnRouter
  readonly qrPdf: QrPdfWorker
  readonly adminEmail: string
  readonly cloudflareAccountId: string
  readonly turnstile: Cloudflare.Turnstile.Widget
  readonly mediaPreviewKey: Output.Output<Redacted.Redacted>
}

export const apiWorker = ({
  config,
  store,
  secrets,
  email,
  emailConfig,
  cdn,
  qrPdf,
  adminEmail,
  cloudflareAccountId,
  turnstile,
  mediaPreviewKey,
}: ApiWorkerInput) =>
  Effect.gen(function* () {
    const sentryDsn = secrets.SENTRY_BACKEND_DSN

    const requestTelemetry = yield* Cloudflare.AnalyticsEngine.Dataset('ApiRequestTelemetry', {
      dataset: `gbfm_api_${config.stage}`,
    })

    if (sentryDsn === undefined) {
      return yield* Effect.die(new Error('SENTRY_BACKEND_DSN secret is missing'))
    }

    const api = yield* Cloudflare.Worker('Api', {
      main: './apps/server/src/worker.ts',
      ...hostname(config, 'api.goosebumps.fm'),
      ...(config.isLocalDev ? { dev: { port: localDevPorts.api, strictPort: true } } : undefined),
      compatibility: { date: '2026-07-04', flags: ['nodejs_compat'] },
      build: privateSourceMaps,
      crons: [reminderSweepCron, sitemapRegenerationCron, maintenanceSweepCron],
      observability: workerObservability(config.isProduction),
      env: {
        DB: store.db,
        MEDIA_PREVIEW_KEY: mediaPreviewKey,
        TURNSTILE_SECRET_KEY: turnstile.secret,
        TURNSTILE_HOSTNAMES: turnstile.domains,
        SIGNUP_RATE_LIMIT: Cloudflare.RateLimit('SignupRateLimit', {
          namespaceId: 1_002,
          simple: { limit: 5, period: 60 },
        }),
        REQUEST_TELEMETRY: requestTelemetry,
        USER_CONTENT: store.userContent,
        MIXES: store.mixes,
        SITEMAP: store.sitemap,
        REMINDERS: store.reminders,
        PLAYLIST_ENRICHMENT: store.playlistEnrichment,
        QR_PDF: qrPdf,
        ...(email === undefined ? undefined : { EMAIL: email }),
        EMAIL_SENDER: emailConfig.emailSender,
        EMAIL_TRANSPORT_MODE: emailConfig.transport,
        NAVIGATION_LOCK: Cloudflare.DurableObject<NavigationLockDurableObject>('NavigationLock', {
          className: 'NavigationLockDurableObject',
        }),
        SPOTIFY_IMPORT_RESOLVER: Cloudflare.DurableObject<SpotifyImportResolverDurableObject>(
          'SpotifyImportResolver',
          {
            className: 'SpotifyImportResolverDurableObject',
          },
        ),
        APP_STAGE: config.stage,
        APP_RELEASE: config.release,
        CLOUDFLARE_ACCOUNT_ID: cloudflareAccountId,
        BROWSER_TELEMETRY_DATASET: `gbfm_www_${config.stage}`,
        ...(config.isLocalDev ? { LOCAL_DEV: 'true' } : undefined),
        CDN_ROUTER_URL: Output.map(cdn.url, (url) => url ?? ''),
        USER_CONTENT_BUCKET_NAME: store.userContent.bucketName,
        MIXES_BUCKET_NAME: store.mixes.bucketName,
        SENTRY_ENVIRONMENT: config.stage,
        ADMIN_EMAIL: adminEmail,
        SHARE_URL: config.isLocalDev ? 'https://gbfm.localhost' : config.apiUrl,
        ...(config.isLocalDev ? { FRONTEND_URL: 'https://gbfm.localhost' } : undefined),
        ...secrets,
        SENTRY_DSN: sentryDsn,
        R2AccountId: store.userContent.accountId,
      },
    })

    yield* Cloudflare.Queues.Consumer('ReminderConsumer', {
      queueId: store.reminders.queueId,
      scriptName: api.workerName,
    })
    yield* Cloudflare.Queues.Consumer('PlaylistEnrichmentConsumer', {
      queueId: store.playlistEnrichment.queueId,
      scriptName: api.workerName,
      deadLetterQueue: store.playlistEnrichmentFailures.queueName,
      settings: { maxRetries: 5, retryDelay: 30 },
    })

    return api
  })
