import { Effect, Layer, Predicate, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/ai'
import { HttpRouter, HttpServer } from 'effect/http'

import { Database, DatabaseLayer } from '@/db/layer'
import { makeMcpRoutes } from '@/http/editorial-mcp.routes'
import { AuthLive } from '@/lib/auth'
import { MdxServiceLayer } from '@/lib/mdx'
import { McpAuthorization, McpAuthorizationLive, McpPermission } from '@/mcp/authorization'
import { EditorialToolError } from '@/mcp/contracts'
import { composeMcpToolkits, EditorialToolkit } from '@/mcp/server'
import { ConfigService } from '@/services/config.service'
import { EditorialOAuthLive } from '@/services/editorial-oauth.service'
import { EmailDeliveryLive } from '@/services/email-delivery.service'
import { RecordingEmailTransportLayer } from '@/services/email-transport.service'
import { getArtistByIdEffect } from '@/services/music-entity/artist.service'
import { PostServiceLayer } from '@/services/post.service'
import { UnavailableObjectStoreClientLayer } from '@/services/storage/object-store-client'
import { UploadAssetServiceLayer } from '@/services/upload-asset.service'

import type { createEditorialOAuthFixture } from './editorial-oauth'

// Deliberately test-only. P1 proves composition, not delivery of an R1 wire tool.
const CatalogueFixture = Toolkit.make(
  Tool.make('fixture_catalogue_artist', {
    parameters: Schema.Struct({ id: Schema.NonEmptyString.check(Schema.isMaxLength(200)) }),
    success: Schema.Struct({
      artist: Schema.Struct({ id: Schema.String, name: Schema.String, slug: Schema.String }),
    }),
    failure: EditorialToolError,
    failureMode: 'return',
  })
    .annotate(McpPermission, { scopes: ['catalogue:read'] })
    .annotate(Tool.Readonly, true),
  // Deliberately lacks a handler check: the transport must enforce declared scopes too.
  Tool.make('fixture_declared_permission', {
    parameters: Schema.Struct({ nonce: Schema.String }),
    success: Schema.Struct({ nonce: Schema.String }),
    failure: EditorialToolError,
    failureMode: 'return',
  }).annotate(McpPermission, { scopes: ['catalogue:write'] }),
)

const handlers = CatalogueFixture.toLayer(
  Effect.gen(function* () {
    const authorization = yield* McpAuthorization
    const db = yield* Database

    return {
      fixture_declared_permission: ({ nonce }) => Effect.succeed({ nonce }),
      fixture_catalogue_artist: ({ id }) =>
        Effect.gen(function* () {
          yield* authorization.catalogue

          const artist = yield* getArtistByIdEffect(id).pipe(
            Effect.mapError(
              (error) =>
                new EditorialToolError({
                  code: Predicate.isTagged(error, 'NotFoundError') ? 'not_found' : 'unavailable',
                  message: 'Catalogue lookup failed.',
                }),
            ),
          )

          return { artist: { id: artist.id, name: artist.name, slug: artist.slug } }
        }).pipe(Effect.provideService(Database, db)),
    }
  }),
).pipe(Layer.provide(McpAuthorizationLive))

export const createComposedMcpFixture = (
  fixture: Awaited<ReturnType<typeof createEditorialOAuthFixture>>,
) => {
  const base = Layer.mergeAll(
    Layer.succeed(ConfigService, {
      ...fixture.config,
      auth: {
        ...fixture.config.auth,
        betterAuthSecret: 'disposable-test-secret-with-at-least-32-chars',
      },
    }),
    MdxServiceLayer,
    UploadAssetServiceLayer,
    UnavailableObjectStoreClientLayer,
  ).pipe(Layer.provideMerge(DatabaseLayer(fixture.db.$client)))

  const email = EmailDeliveryLive.pipe(
    Layer.provide(RecordingEmailTransportLayer),
    Layer.provide(base),
  )

  const services = Layer.mergeAll(
    base,
    PostServiceLayer.pipe(Layer.provide(base)),
    EditorialOAuthLive.pipe(Layer.provide(base)),
    AuthLive.pipe(Layer.provide(email), Layer.provide(base)),
  )

  return HttpRouter.toWebHandler(
    makeMcpRoutes(composeMcpToolkits(EditorialToolkit, CatalogueFixture), handlers).pipe(
      Layer.provide(services),
      Layer.provide(HttpServer.layerServices),
    ),
    { disableLogger: true },
  )
}
