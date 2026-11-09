import type { D1Database } from '@cloudflare/workers-types'
import { Layer } from 'effect'

import { DatabaseLayer } from '@/db/layer'
import { createWebHandler } from '@/http/routes'
import { McpOperationStoreLayer } from '@/mcp/operations/store'
import {
  WorkerSentryEnabledLive,
  WorkerSentryEnv,
  WorkerTracingLive,
} from '@/runtime/sentry-worker'
import { AppLayer, type AppLayerOptions } from '@/runtime/services'
import { MusicCoverImageFetcher } from '@/services/canonical-music-identity/artwork-delivery'
import type { ConfigService } from '@/services/config.service'
import type { EditorialListCache } from '@/services/editorial-list-cache'
import {
  RecordingEmailTransportLayer,
  type EmailTransportService,
} from '@/services/email-transport.service'
import { PlaylistEnrichmentQueueTestLayer } from '@/services/playlist-enrichment-queue'
import type { RequestTelemetry } from '@/services/request-telemetry.service'
import { SentryServiceLayer } from '@/services/sentry.service'
import type { SignupProtection } from '@/services/signup-protection'
import { SitemapCacheLayer, type SitemapKv } from '@/services/sitemap-cache'
import { SpotifyImportResolverLocalLayer } from '@/services/spotify-import-resolver.service'
import type { ObjectStoreClient } from '@/services/storage/object-store-client'

// Tests never call Sentry.withSentry, so Sentry stays disabled (no DSN) and
// the tracing layer falls back to OpenTelemetry's no-op global tracer --
// matching how the Worker behaves in an environment with no SENTRY_DSN set.
// Exported so other test-only AppLayer compositions (e.g.
// health.handlers.failure.test.ts) don't each rebuild this wiring.
export const testSentryServiceLive = SentryServiceLayer.pipe(
  Layer.provide(WorkerSentryEnabledLive),
  Layer.provide(Layer.succeed(WorkerSentryEnv, { dsn: undefined, environment: 'test' })),
)

const inMemorySitemapKv = (): SitemapKv => {
  const store = new Map<string, string>()

  return {
    get: async (key) => {
      const value = store.get(key)

      return value ? JSON.parse(value) : null
    },
    put: async (key, value) => {
      store.set(key, value)
    },
  }
}

// Mirrors worker.ts's request-scope composition (DatabaseLayer(env.DB),
// SitemapCacheLayer(env.SITEMAP)) with a migrated Miniflare D1 database and
// an in-memory KV stand-in, so HTTP tests exercise the same AppLayer shape
// the Worker builds per request instead of the module-level singleton, which
// intentionally dies outside the Worker request path.
//
// Takes the D1Database instance rather than creating its own so a suite that
// also seeds rows directly (via drizzle's `db` from src/test/database.ts)
// reads and writes the same underlying database as the handler under test.
/** Creates a Worker-shaped HTTP handler with caller-chosen external service test seams. */
export const createTestWebHandler = (
  d1: D1Database,
  emailTransportLive: Layer.Layer<EmailTransportService> = RecordingEmailTransportLayer,
  objectStoreLive?: Layer.Layer<ObjectStoreClient>,
  musicCoverImageFetcherLive: Layer.Layer<never> = Layer.succeed(MusicCoverImageFetcher, fetch),
  configLive?: Layer.Layer<ConfigService>,
  signupProtection?: Layer.Layer<SignupProtection>,
  externalMediaFetcherLive?: Layer.Layer<never>,
  options?: {
    readonly editorialListCache?: Layer.Layer<EditorialListCache>
    readonly requestTelemetry?: Layer.Layer<RequestTelemetry>
  },
) => {
  const baseServices = {
    database: DatabaseLayer(d1),
    operationStore: McpOperationStoreLayer(d1),
    sitemapCache: SitemapCacheLayer(inMemorySitemapKv()),
    spotifyImportResolver: SpotifyImportResolverLocalLayer,
    playlistEnrichmentQueue: PlaylistEnrichmentQueueTestLayer,
    sentry: testSentryServiceLive,
    tracing: WorkerTracingLive,
    emailTransport: emailTransportLive,
    musicCoverImageFetcher: musicCoverImageFetcherLive,
    ...(signupProtection ? { signupProtection } : undefined),
    ...(externalMediaFetcherLive ? { externalMediaFetcher: externalMediaFetcherLive } : undefined),
    ...options,
  }

  const services = configLive === undefined ? baseServices : { ...baseServices, config: configLive }

  const appLayerOptions: AppLayerOptions =
    objectStoreLive === undefined ? services : { ...services, objectStore: objectStoreLive }

  const appServicesLive = AppLayer(appLayerOptions)

  return createWebHandler({ appServicesLive })
}
