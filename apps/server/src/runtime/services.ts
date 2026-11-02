import { Layer } from 'effect'

import type { Database } from '@/db/layer'
import { AuthLive } from '@/lib/auth'
import { CryptoLive } from '@/lib/crypto'
import { MdxServiceCatalogLayer } from '@/lib/mdx'
import {
  EditorialListCacheUnavailableLayer,
  type EditorialListCache,
} from '@/services/editorial-list-cache'
import { PersonalAccessKeysLive } from '@/services/personal-access-keys'
import type { SentryService } from '@/services/sentry.service'
import type { SitemapCache } from '@/services/sitemap-cache'

export { Database, DatabaseLayer } from '@/db/layer'

import {
  AdminTelemetryUnavailableLayer,
  type AdminTelemetryService,
} from '@/services/admin-telemetry.service'
import { AudioServiceLayer } from '@/services/audio.service'
import { CanonicalMusicIdentityLayer } from '@/services/canonical-music-identity'
import { MusicCoverImageFetcher } from '@/services/canonical-music-identity/artwork-delivery'
import { ConfigServiceLayer, type ConfigService } from '@/services/config.service'
import { DeezerServiceLayer } from '@/services/deezer.service'
import { EmailDeliveryLive } from '@/services/email-delivery.service'
import type { EmailTransportService } from '@/services/email-transport.service'
import { FavoriteServiceLayer } from '@/services/favorite.service'
import { AppLoggerLive } from '@/services/logger.service'
import { MusicEntityServiceLayer } from '@/services/music-entity'
import { MusicLinkScraperServiceLayer } from '@/services/music-link-scraper.service'
import { MusicReminderServiceLayer } from '@/services/music-reminder.service'
import { MusicBrainzIdentityLive } from '@/services/musicbrainz-identity.service'
import { NavigationRetentionServiceLayer } from '@/services/navigation-retention.service'
import { NavigationServiceLayer } from '@/services/navigation.service'
import type { PlaylistEnrichmentQueue } from '@/services/playlist-enrichment-queue'
import { PostServiceLayer } from '@/services/post.service'
import { ProfileServiceLayer } from '@/services/profile.service'
import { type QRCodeService, QRCodeServiceUnavailableLayer } from '@/services/qrcode.service'
import { ReleaseServiceLayer } from '@/services/release.service'
import { ReminderSignalServiceLayer } from '@/services/reminder-signal.service'
import {
  type RequestTelemetry,
  RequestTelemetryUnavailableLayer,
} from '@/services/request-telemetry.service'
import { ResolveServiceLayer } from '@/services/resolve.service'
import { RichContentMusicResolverLayer } from '@/services/rich-content-music.service'
import { S3ServiceLayer } from '@/services/s3.service'
import { SearchServiceLayer } from '@/services/search.service'
import { ShowServiceLayer, ShowSubscriptionServiceLayer } from '@/services/show.service'
import {
  type SignupProtection,
  SignupProtectionUnavailableLayer,
} from '@/services/signup-protection'
import type { SpotifyImportResolver } from '@/services/spotify-import-resolver.service'
import { SpotifyServiceLayer } from '@/services/spotify.service'
import {
  type ObjectStoreClient,
  UnavailableObjectStoreClientLayer,
} from '@/services/storage/object-store-client'
import { UploadAssetServiceLayer } from '@/services/upload-asset.service'
import { UserServiceLayer } from '@/services/user.service'

const DevToolsLive: Layer.Layer<never> = Layer.empty

// Takes the Database, SitemapCache, coordination, Sentry, and Effect-tracing layers as
// parameters instead of building them from module-scope bindings: Bun and
// the Worker initialize Sentry and OpenTelemetry differently (@sentry/bun
// vs @sentry/cloudflare, which cannot share a module -- see
// sentry-client.service.ts and worker.ts), and the composition seam is the
// only place that may choose between them.
export interface AppLayerOptions {
  readonly database: Layer.Layer<Database>
  readonly sitemapCache: Layer.Layer<SitemapCache>
  readonly spotifyImportResolver: Layer.Layer<SpotifyImportResolver, never, Database>
  readonly playlistEnrichmentQueue: Layer.Layer<PlaylistEnrichmentQueue>
  readonly sentry: Layer.Layer<SentryService>
  readonly tracing: Layer.Layer<never>
  readonly emailTransport: Layer.Layer<EmailTransportService>
  readonly config?: Layer.Layer<ConfigService>
  readonly objectStore?: Layer.Layer<ObjectStoreClient>
  readonly qrCode?: Layer.Layer<QRCodeService>
  readonly musicCoverImageFetcher?: Layer.Layer<never>
  readonly externalMediaFetcher?: Layer.Layer<never>
  readonly adminTelemetry?: Layer.Layer<AdminTelemetryService>
  readonly requestTelemetry?: Layer.Layer<RequestTelemetry>
  readonly signupProtection?: Layer.Layer<SignupProtection>
  readonly editorialListCache?: Layer.Layer<EditorialListCache>
}

export const AppLayer = ({
  database: databaseLive,
  sitemapCache: sitemapCacheLive,
  spotifyImportResolver: spotifyImportResolverLive,
  playlistEnrichmentQueue: playlistEnrichmentQueueLive,
  sentry: sentryLive,
  tracing: tracingLive,
  emailTransport: emailTransportLive,
  config: configLive = ConfigServiceLayer,
  objectStore: objectStoreLive = UnavailableObjectStoreClientLayer,
  qrCode: qrCodeLive = QRCodeServiceUnavailableLayer,
  musicCoverImageFetcher: musicCoverImageFetcherLive = Layer.succeed(MusicCoverImageFetcher, fetch),
  externalMediaFetcher: externalMediaFetcherLive = Layer.empty,
  adminTelemetry: adminTelemetryLive = AdminTelemetryUnavailableLayer,
  requestTelemetry: requestTelemetryLive = RequestTelemetryUnavailableLayer,
  signupProtection: signupProtectionLive = SignupProtectionUnavailableLayer,
  editorialListCache: editorialListCacheLive = EditorialListCacheUnavailableLayer,
}: AppLayerOptions) => {
  const EmailDeliveryWithDependencies = EmailDeliveryLive.pipe(
    Layer.provide(Layer.mergeAll(databaseLive, configLive, emailTransportLive)),
  )

  const UploadAssetDepsLive = Layer.mergeAll(configLive, UploadAssetServiceLayer)

  const MdxLive = MdxServiceCatalogLayer.pipe(
    Layer.provide(RichContentMusicResolverLayer),
    Layer.provide(databaseLive),
    Layer.provide(externalMediaFetcherLive),
  )

  const BaseServicesLayer = Layer.mergeAll(
    PersonalAccessKeysLive.pipe(Layer.provide(CryptoLive)),
    EmailDeliveryWithDependencies,
    FavoriteServiceLayer,
    SpotifyServiceLayer.pipe(Layer.provide(configLive)),
    DeezerServiceLayer,
    MusicBrainzIdentityLive,
    musicCoverImageFetcherLive,
    MusicReminderServiceLayer,
    playlistEnrichmentQueueLive,
    NavigationRetentionServiceLayer,
    spotifyImportResolverLive,
    NavigationServiceLayer,
    ReminderSignalServiceLayer,
    MusicLinkScraperServiceLayer.pipe(
      Layer.provide(
        Layer.mergeAll(SpotifyServiceLayer, DeezerServiceLayer, MusicBrainzIdentityLive),
      ),
    ),
    AudioServiceLayer.pipe(
      Layer.provide(MdxLive),
      Layer.provide(UploadAssetDepsLive),
      Layer.provide(objectStoreLive),
    ),
    PostServiceLayer.pipe(
      Layer.provide(MdxLive),
      Layer.provide(UploadAssetDepsLive),
      Layer.provide(objectStoreLive),
    ),
    ProfileServiceLayer,
    ResolveServiceLayer.pipe(Layer.provide(MdxLive)),
    ReleaseServiceLayer.pipe(Layer.provide(MdxLive), Layer.provide(objectStoreLive)),
    S3ServiceLayer.pipe(Layer.provide(Layer.mergeAll(objectStoreLive, configLive))),
    SearchServiceLayer,
    sentryLive,
    tracingLive,
    ShowServiceLayer.pipe(Layer.provide(MdxLive), Layer.provide(objectStoreLive)),
    ShowSubscriptionServiceLayer,
    UploadAssetServiceLayer,
    UserServiceLayer,
    DevToolsLive,
    adminTelemetryLive,
    requestTelemetryLive,
    signupProtectionLive,
  ).pipe(Layer.provideMerge(configLive), Layer.provide(databaseLive))

  const CanonicalMusicIdentityLive = CanonicalMusicIdentityLayer.pipe(
    Layer.provide(BaseServicesLayer),
  )

  const MusicEntityLive = MusicEntityServiceLayer.pipe(
    Layer.provide(Layer.mergeAll(BaseServicesLayer, CanonicalMusicIdentityLive, MdxLive)),
  )

  const ServicesLayer = Layer.mergeAll(
    BaseServicesLayer,
    qrCodeLive,
    CanonicalMusicIdentityLive,
    MusicEntityLive,
  ).pipe(Layer.provide(databaseLive))

  return Layer.mergeAll(
    ServicesLayer,
    objectStoreLive,
    databaseLive,
    sitemapCacheLive,
    editorialListCacheLive,
    AuthLive.pipe(
      Layer.provide(Layer.mergeAll(databaseLive, configLive, EmailDeliveryWithDependencies)),
    ),
    AppLoggerLive.pipe(Layer.provide(configLive)),
  ).pipe(Layer.provide(configLive))
}
