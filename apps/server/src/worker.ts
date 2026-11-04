import type {
  AnalyticsEngineDataset,
  D1Database,
  DurableObjectNamespace,
  ExecutionContext,
  Fetcher,
  KVNamespace,
  MessageBatch,
  Queue,
  RateLimit,
  R2Bucket,
  ScheduledController,
  SendEmail,
} from '@cloudflare/workers-types'
import { resolveRequestId } from '@gbfm/core/observability/request-id'
import { traceSampleRate } from '@gbfm/core/observability/trace-sampling'
import * as Sentry from '@sentry/cloudflare'
import type { ErrorEvent, TracesSamplerSamplingContext, TransactionEvent } from '@sentry/core'
import { Effect, Layer, Predicate, Redacted, Schema, Tracer } from 'effect'
import { FetchHttpClient } from 'effect/http'

import { DatabaseLayer, makeDatabaseClient } from '@/db/layer'
import { seedLocalUsers } from '@/db/seed-local-users'
import type { NavigationLockDurableObject } from '@/durable-objects/navigation-lock.do'
import type { SpotifyImportResolverDurableObject } from '@/durable-objects/spotify-import-resolver.do'
import { DatabaseError, getErrorMessage } from '@/errors'
import { createWebHandler } from '@/http/routes'
import { sanitizeDatabaseSpan } from '@/lib/database-telemetry'
import { localTracer, traceLocalRequest } from '@/lib/local-request-tracing'
import { omitUndefined } from '@/lib/omit-undefined'
import { hasLocalSentryContext, shouldEnableSentry } from '@/lib/sentry'
import { regenerateSitemap } from '@/routes/redirect/seo/sitemap.service'
import {
  WorkerSentryEnabledLive,
  WorkerSentryEnv,
  WorkerTracingLive,
} from '@/runtime/sentry-worker'
import { AppLayer } from '@/runtime/services'
import { dispatchScheduledJob } from '@/scheduled'
import {
  AdminTelemetryServiceLive,
  AnalyticsEngineConfig,
} from '@/services/admin-telemetry.service'
import { CloudflareEmailTransportLayer } from '@/services/cloudflare-email.adapter'
import {
  ConfigService,
  WorkerConfigServiceLayerEffect,
  type WorkerConfigBindings,
} from '@/services/config.service'
import { EditorialListCacheLayer } from '@/services/editorial-list-cache'
import {
  RecordingEmailTransportLayer,
  UnconfiguredEmailTransportLayer,
} from '@/services/email-transport.service'
import { MusicEntityService } from '@/services/music-entity'
import { NavigationRetentionService } from '@/services/navigation-retention.service'
import {
  PlaylistEnrichmentJob,
  PlaylistEnrichmentQueueLayer,
} from '@/services/playlist-enrichment-queue'
import { cleanupExpiredQrPdfs } from '@/services/qr-cache-cleanup'
import { QRCodeServiceLayer } from '@/services/qrcode.service'
import { processReminderJob, queryDueReminders } from '@/services/reminder-processor'
import { ReminderQueue, ReminderQueueLayer, type ReminderJob } from '@/services/reminder-queue'
import { RequestTelemetryLive } from '@/services/request-telemetry.service'
import { resolveSecretBindings } from '@/services/secrets-store.service'
import { SentryServiceLayer } from '@/services/sentry.service'
import { SignupProtectionLayer } from '@/services/signup-protection'
import { SitemapCacheLayer } from '@/services/sitemap-cache'
import {
  canonicalSpotifyImportResolverName,
  SpotifyImportResolver,
} from '@/services/spotify-import-resolver.service'
import { R2ObjectStoreClientLayer } from '@/services/storage/r2-object-store-client'

export { NavigationLockDurableObject } from '@/durable-objects/navigation-lock.do'

export { SpotifyImportResolverDurableObject } from '@/durable-objects/spotify-import-resolver.do'

// The only file that sees env, ExecutionContext, or a Cloudflare binding
// type. Every other module receives capabilities named in domain terms
// (Database, SitemapCache, ReminderQueue), never D1Database/KVNamespace/Queue
// directly.
export type ApiEnv = WorkerConfigBindings & {
  readonly APP_RELEASE: string
  readonly DB: D1Database
  readonly REQUEST_TELEMETRY: AnalyticsEngineDataset
  readonly USER_CONTENT: R2Bucket
  readonly MIXES: R2Bucket
  readonly SITEMAP: KVNamespace
  readonly REMINDERS: Queue<ReminderJob>
  readonly PLAYLIST_ENRICHMENT: Queue<PlaylistEnrichmentJob>
  readonly QR_PDF: Fetcher
  readonly EMAIL?: SendEmail
  readonly EMAIL_TRANSPORT_MODE?: 'cloudflare' | 'recording'
  readonly NAVIGATION_LOCK: DurableObjectNamespace<NavigationLockDurableObject>
  readonly SPOTIFY_IMPORT_RESOLVER: DurableObjectNamespace<SpotifyImportResolverDurableObject>
  readonly SENTRY_DSN?: string
  readonly SENTRY_ENVIRONMENT?: string
  readonly TURNSTILE_SECRET_KEY: string
  readonly TURNSTILE_HOSTNAMES: ReadonlyArray<string>
  readonly SIGNUP_RATE_LIMIT: RateLimit
}

const workerSentryEnvLive = (env: ApiEnv) =>
  Layer.succeed(WorkerSentryEnv, { dsn: env.SENTRY_DSN, environment: env.SENTRY_ENVIRONMENT })

const workerSentryServiceLive = (env: ApiEnv) =>
  SentryServiceLayer.pipe(
    Layer.provide(WorkerSentryEnabledLive),
    Layer.provide(workerSentryEnvLive(env)),
  )

const spotifyImportResolverError = (operation: string, cause: unknown) =>
  new DatabaseError({
    message: `Failed to ${operation} Spotify import resolver: ${getErrorMessage(cause)}`,
    operation,
    table: 'music_entity_links',
  })

const spotifyImportResolverLive = (env: ApiEnv) =>
  Layer.succeed(SpotifyImportResolver, {
    resolveTrack: (track) =>
      Effect.tryPromise({
        try: async () => {
          const canonicalName = canonicalSpotifyImportResolverName('track', track.trackUrl)

          const stub = env.SPOTIFY_IMPORT_RESOLVER.get(
            env.SPOTIFY_IMPORT_RESOLVER.idFromName(canonicalName),
          )

          return await stub.resolveTrack(track)
        },
        catch: (error) => spotifyImportResolverError('resolve track', error),
      }),
    resolvePlaylist: (playlist, coverImageUrl, curatorId) =>
      Effect.tryPromise({
        try: async () => {
          const canonicalName = canonicalSpotifyImportResolverName('playlist', playlist.playlistUrl)

          const stub = env.SPOTIFY_IMPORT_RESOLVER.get(
            env.SPOTIFY_IMPORT_RESOLVER.idFromName(canonicalName),
          )

          return await stub.resolvePlaylist(playlist, coverImageUrl, curatorId)
        },
        catch: (error) => spotifyImportResolverError('resolve playlist', error),
      }),
  })

const appServicesLive = (
  env: ApiEnv,
  tracing: Layer.Layer<never> = WorkerTracingLive,
  waitUntil?: (delivery: Promise<void>) => void,
  editorialOrigin?: string,
) => {
  const configLive = WorkerConfigServiceLayerEffect(
    resolveSecretBindings(env).pipe(
      Effect.map((secrets) => ({ ...env, ...secrets })),
      // An unreadable secret cannot degrade to blank config: that would boot a
      // Worker with no database password and surface as confusing auth errors.
      Effect.orDie,
    ),
  )

  const objectStoreLive = R2ObjectStoreClientLayer({
    userContent: env.USER_CONTENT,
    mixes: env.MIXES,
  }).pipe(Layer.provide(configLive))

  const analyticsConfigLive = Layer.effect(
    AnalyticsEngineConfig,
    Effect.map(ConfigService, (config) => ({
      accountId: config.analytics.accountId,
      apiToken: config.analytics.apiToken,
      dataset: config.analytics.browserDataset,
    })),
  ).pipe(Layer.provide(configLive))

  const adminTelemetryLive = AdminTelemetryServiceLive.pipe(
    Layer.provide(analyticsConfigLive),
    Layer.provide(FetchHttpClient.layer),
  )

  return AppLayer({
    ...(env.LOCAL_DEV !== 'true' && editorialOrigin
      ? {
          editorialListCache: EditorialListCacheLayer(caches.default, {
            origin: editorialOrigin,
            release: env.APP_RELEASE,
          }),
        }
      : undefined),
    database: DatabaseLayer(env.DB),
    sitemapCache: SitemapCacheLayer(env.SITEMAP),
    spotifyImportResolver: spotifyImportResolverLive(env),
    playlistEnrichmentQueue: playlistEnrichmentQueueLive(env),
    sentry: workerSentryServiceLive(env),
    tracing,
    config: configLive,
    objectStore: objectStoreLive,
    qrCode: QRCodeServiceLayer({ fetch: (request) => env.QR_PDF.fetch(request) }),
    requestTelemetry: RequestTelemetryLive({
      release: env.APP_RELEASE,
      stage: env.APP_STAGE,
      writer: env.REQUEST_TELEMETRY,
      localLogs: env.LOCAL_DEV === 'true',
      ...(waitUntil ? { waitUntil } : undefined),
    }),
    adminTelemetry: adminTelemetryLive,
    signupProtection: SignupProtectionLayer({
      secret: Redacted.make(env.TURNSTILE_SECRET_KEY),
      hostnames: env.TURNSTILE_HOSTNAMES,
      limit: async (key) => (await env.SIGNUP_RATE_LIMIT.limit({ key })).success,
    }).pipe(Layer.provide(FetchHttpClient.layer)),
    emailTransport:
      env.EMAIL !== undefined
        ? CloudflareEmailTransportLayer(env.EMAIL)
        : env.EMAIL_TRANSPORT_MODE === 'recording'
          ? RecordingEmailTransportLayer
          : UnconfiguredEmailTransportLayer,
  })
}

const sentryOptions = (env: ApiEnv) => {
  const dsn = env.SENTRY_DSN ?? ''
  const environment = env.SENTRY_ENVIRONMENT ?? 'development'

  if (!shouldEnableSentry(dsn, environment)) return undefined

  return {
    dsn,
    environment,
    tracesSampler: ({
      inheritOrSampleWith,
      name,
      normalizedRequest,
    }: TracesSamplerSamplingContext) =>
      inheritOrSampleWith(traceSampleRate(omitUndefined({ name, url: normalizedRequest?.url }))),

    sendDefaultPii: false,
    enableLogs: true,
    beforeSendSpan: sanitizeDatabaseSpan,
    beforeSend: (event: ErrorEvent) => (hasLocalSentryContext(event) ? null : event),
    beforeSendTransaction: (event: TransactionEvent) =>
      hasLocalSentryContext(event) ? null : event,
  }
}

const reminderQueueLive = (env: ApiEnv) => ReminderQueueLayer(env.REMINDERS)

const playlistEnrichmentQueueLive = (env: ApiEnv) =>
  PlaylistEnrichmentQueueLayer(env.PLAYLIST_ENRICHMENT)

const enqueueDueReminders = Effect.gen(function* () {
  const dueReminders = yield* queryDueReminders
  const reminderQueue = yield* ReminderQueue

  yield* Effect.forEach(
    dueReminders,
    (reminder) =>
      reminderQueue.enqueue({
        reminderId: reminder.id,
        idempotencyKey: reminder.id,
        dueAt: reminder.reminderDate.getTime(),
      }),
    { concurrency: 5 },
  )
}).pipe(
  Effect.catch((error) => Effect.logError('[worker.scheduled] reminder sweep failed', { error })),
)

const runReminderSweep = (env: ApiEnv) =>
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- Scheduled dispatch is an Effect application entry point.
  Effect.provide(enqueueDueReminders, [appServicesLive(env), reminderQueueLive(env)])

const runSitemapRegeneration = (env: ApiEnv) =>
  regenerateSitemap.pipe(
    Effect.asVoid,
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- Scheduled dispatch is an Effect application entry point.
    Effect.provide(appServicesLive(env)),
    Effect.catch((error) =>
      Effect.logError('[worker.scheduled] sitemap regeneration failed', { error }),
    ),
  )

const runMaintenanceSweep = (env: ApiEnv) =>
  Effect.gen(function* () {
    const retention = yield* NavigationRetentionService
    const report = yield* retention.sweepExpiredAnonymousSessions(new Date())
    yield* Effect.logInfo('[worker.scheduled] navigation retention sweep finished', report)
  }).pipe(
    Effect.catch((error) =>
      Effect.logError('[worker.scheduled] navigation retention sweep failed', { error }),
    ),
    // Replaces the S3 lifecycle rule that expired `qr-pdfs/` after a day. R2
    // lifecycle rules cannot target a prefix, so the sweep does it instead.
    Effect.andThen(
      cleanupExpiredQrPdfs.pipe(
        Effect.tap((report) =>
          Effect.logInfo('[worker.scheduled] qr pdf cleanup finished', report),
        ),
        Effect.catch((error) =>
          Effect.logError('[worker.scheduled] qr pdf cleanup failed', { error }),
        ),
        Effect.asVoid,
      ),
    ),
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- Scheduled dispatch is an Effect application entry point.
    Effect.provide(appServicesLive(env)),
  )

// Claims a reminder with a guarded UPDATE from PENDING or FAILED. FAILED is
// retry-eligible after a prior delivery invocation returns an error. Zero rows
// means another invocation owns the reminder, so this delivery can be acked.
const processReminderMessage = (env: ApiEnv, job: ReminderJob) =>
  processReminderJob(job.reminderId).pipe(
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- Queue dispatch is an Effect application entry point.
    Effect.provide(appServicesLive(env)),
  )

const processPlaylistEnrichmentMessage = (env: ApiEnv, payload: PlaylistEnrichmentJob) =>
  Effect.gen(function* () {
    const job = yield* Schema.decodeUnknownEffect(PlaylistEnrichmentJob)(payload)
    const music = yield* MusicEntityService
    const startedAt = Date.now()

    const result = yield* job.reason === 'manual'
      ? music.syncPlaylistLinks(job.playlistId)
      : music.enrichPlaylistLinks(job.playlistId)

    yield* Effect.logInfo('[worker.queue] Playlist link enrichment finished', {
      ...result,
      durationMs: Date.now() - startedAt,
    })
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- Queue dispatch is an Effect application entry point.
  }).pipe(Effect.provide(appServicesLive(env)))

type ApiQueueJob = ReminderJob | PlaylistEnrichmentJob

export default Sentry.withSentry<ApiEnv, ApiQueueJob>(sentryOptions, {
  async fetch(request: Request, env: ApiEnv, ctx: ExecutionContext): Promise<Response> {
    return ctx.tracing.enterSpan('gbfm.api.request', async (span): Promise<Response> => {
      const incomingRequestId = request.headers.get('x-request-id')
      const requestId = resolveRequestId(incomingRequestId)
      const headers = new Headers(request.headers)
      headers.set('x-request-id', requestId)
      const correlatedRequest = new Request(request, { headers })

      span.setAttribute('http.request.method', correlatedRequest.method)
      span.setAttribute('gbfm.request_id', requestId)
      span.setAttribute('gbfm.release', env.APP_RELEASE)
      span.setAttribute('service.name', 'api')
      const url = new URL(request.url)

      if (correlatedRequest.method === 'POST' && url.pathname === '/api/dev/seed') {
        if (env.LOCAL_DEV !== 'true') return new Response('Not Found', { status: 404 })
        const result = await seedLocalUsers(makeDatabaseClient(env.DB))

        return Response.json(result, { headers: { 'x-request-id': requestId } })
      }

      const local = env.LOCAL_DEV === 'true'
      const tracing = local ? Layer.succeed(Tracer.Tracer, await localTracer()) : WorkerTracingLive

      const webHandler = createWebHandler({
        appServicesLive: appServicesLive(
          env,
          tracing,
          (delivery) => ctx.waitUntil(delivery),
          url.origin,
        ),
        localTracing: local,
      })

      try {
        const response = await (local
          ? traceLocalRequest(
              () => webHandler.handler(correlatedRequest),
              (promise) => ctx.waitUntil(promise),
            )
          : webHandler.handler(correlatedRequest))

        const output = new Response(response.body, response)
        output.headers.set('x-request-id', requestId)

        return output
      } finally {
        await webHandler.dispose()
      }
    })
  },

  scheduled(controller: ScheduledController, env: ApiEnv): Promise<void> {
    return dispatchScheduledJob(controller.cron, {
      regenerateSitemap: () => Effect.runPromise(runSitemapRegeneration(env)),
      sweepReminders: () => Effect.runPromise(runReminderSweep(env)),
      runMaintenance: () => Effect.runPromise(runMaintenanceSweep(env)),
    })
  },

  async queue(batch: MessageBatch<ApiQueueJob>, env: ApiEnv): Promise<void> {
    for (const message of batch.messages) {
      const job = message.body

      const exit =
        '_tag' in job
          ? await Effect.runPromiseExit(processPlaylistEnrichmentMessage(env, job))
          : await Effect.runPromiseExit(processReminderMessage(env, job))

      if (Predicate.isTagged('Success')(exit)) {
        message.ack()
      } else {
        await Effect.runPromise(
          Effect.logError('[worker.queue] Job failed; requesting retry', {
            jobType: '_tag' in job ? 'playlist_enrichment' : 'reminder',
          }),
        )
        message.retry()
      }
    }
  },
})
