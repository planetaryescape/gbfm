import { ReadinessCheckFailedError } from '@gbfm/api/errors'
import { decodeResponseBody } from '@gbfm/api/testing'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { DatabaseLayer } from '@/db/layer'
import { McpOperationStoreLayer } from '@/mcp/operations/store'
import { WorkerTracingLive } from '@/runtime/sentry-worker'
import { AppLayer } from '@/runtime/services'
import { RecordingEmailTransportLayer } from '@/services/email-transport.service'
import { PlaylistEnrichmentQueueTestLayer } from '@/services/playlist-enrichment-queue'
import { SitemapCacheLayer } from '@/services/sitemap-cache'
import { SpotifyImportResolverLocalLayer } from '@/services/spotify-import-resolver.service'
import { d1 } from '@/test/database'
import { testSentryServiceLive } from '@/test/http-handler'

import { createWebHandler } from './routes'

// Mirrors worker.ts's per-request AppLayer composition instead of the
// module-level singleton, which intentionally dies outside the Worker
// request path (OPS-254). The injected healthDatabaseCheck below never
// touches Database itself, but createWebHandler still builds every other
// handler group against this same appServicesLive -- including its own
// SentryServiceLayer, so unlike before, nothing here needs @/app's
// side-effecting SentryService init anymore.
const testAppServicesLive = AppLayer({
  database: DatabaseLayer(d1),
  operationStore: McpOperationStoreLayer(d1),
  sitemapCache: SitemapCacheLayer({
    get: async () => null,
    put: async () => {},
  }),
  spotifyImportResolver: SpotifyImportResolverLocalLayer,
  playlistEnrichmentQueue: PlaylistEnrichmentQueueTestLayer,
  sentry: testSentryServiceLive,
  tracing: WorkerTracingLive,
  emailTransport: RecordingEmailTransportLayer,
})

// Separate file (docs/migration-effect-http-api.md, step 3a): each
// createWebHandler builds its own cached readiness check (health.handlers.ts,
// Effect.cachedWithTTL inside makeHealthHandlers), so this doesn't strictly
// need isolation from routes.blackbox.test.ts anymore -- kept in its own file
// as a dedicated home for the failure/concurrency paths.
describe('health readiness failure + cache', () => {
  it('caches a failing readiness check and does not re-run it within the window', async () => {
    let checks = 0

    const scoped = createWebHandler({
      healthDatabaseCheck: Effect.sync(() => {
        checks += 1
      }).pipe(
        Effect.flatMap(() => Effect.fail(new ReadinessCheckFailedError({ dbConnected: false }))),
      ),
      appServicesLive: testAppServicesLive,
    })

    try {
      const first = await scoped.handler(new Request('http://localhost/health/ready'))
      const second = await scoped.handler(new Request('http://localhost/health/ready'))

      expect(first.status).toBe(500)
      expect(second.status).toBe(500)

      const decoded = await decodeResponseBody(ReadinessCheckFailedError, first)
      expect(decoded._tag).toBe('ReadinessCheckFailedError')
      expect(decoded.dbConnected).toBe(false)

      // Second call must reuse the cached failure, not re-run the check.
      expect(checks).toBe(1)
    } finally {
      await scoped.dispose()
    }
  })

  it('concurrent requests on a cold cache share one in-flight check, not one each', async () => {
    let checks = 0

    const scoped = createWebHandler({
      healthDatabaseCheck: Effect.sync(() => {
        checks += 1
      }).pipe(Effect.delay('20 millis')),
      appServicesLive: testAppServicesLive,
    })

    try {
      const [first, second] = await Promise.all([
        scoped.handler(new Request('http://localhost/health/ready')),
        scoped.handler(new Request('http://localhost/health/ready')),
      ])

      expect(first.status).toBe(200)
      expect(second.status).toBe(200)
      // Both requests arrived before the (delayed) check completed -- they
      // must share the one in-flight computation, not race to run it twice.
      expect(checks).toBe(1)
    } finally {
      await scoped.dispose()
    }
  })
})
