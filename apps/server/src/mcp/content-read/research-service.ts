import { Context, Effect, Layer, Schema } from 'effect'

import { Database } from '@/db/layer'
import { AudioService } from '@/services/audio.service'
import { publicListeningCollectionPage } from '@/services/listening.service'
import { ProfileService } from '@/services/profile.service'
import { SearchService } from '@/services/search.service'

import { McpAuthorization, McpAuthorizationLive } from '../authorization'
import { EditorialToolError, EndpointIdentity } from '../contracts'
import { EditorialMcpConfig } from '../editorial'
import {
  type PublicCollectionInput,
  PublicCollectionResult,
  type PublicMixInput,
  PublicMixResult,
  type PublicProfileInput,
  PublicProfileResult,
  type PublicSearchInput,
  PublicSearchResult,
} from './research-contracts'

const unavailable = () =>
  new EditorialToolError({ code: 'unavailable', message: 'Public content is unavailable.' })

const missing = () => new EditorialToolError({ code: 'not_found', message: 'Content not found.' })

const boundResult = <A>(output: A) =>
  new TextEncoder().encode(JSON.stringify(output)).byteLength > 256 * 1024
    ? Effect.fail(unavailable())
    : Effect.succeed(output)

const makeResearch = Effect.gen(function* () {
  const authorization = yield* McpAuthorization
  const search = yield* SearchService
  const audio = yield* AudioService
  const profiles = yield* ProfileService
  const db = yield* Database
  const config = yield* EditorialMcpConfig

  const endpoint = yield* Schema.decodeUnknownEffect(EndpointIdentity)(config).pipe(
    Effect.mapError(unavailable),
  )

  const searchCatalogue = Effect.fn('PublicResearch.search')(function* (
    input: typeof PublicSearchInput.Type,
  ) {
    yield* authorization.requireScopes(['content:read'])

    const page = yield* search
      .searchPublicPage(input.query, {
        kind: input.kind,
        limit: input.limit ?? 20,
        offset: input.offset ?? 0,
      })
      .pipe(Effect.mapError(unavailable))

    return yield* Schema.decodeUnknownEffect(PublicSearchResult)({
      endpoint,
      kind: input.kind,
      results: page.data,
      pagination: page.pagination,
    }).pipe(Effect.mapError(unavailable), Effect.flatMap(boundResult))
  })

  const getMix = Effect.fn('PublicResearch.mix')(function* (input: typeof PublicMixInput.Type) {
    yield* authorization.requireScopes(['content:read'])

    const mix = yield* audio.getPublicMixSummaryBySlug(input.slug).pipe(
      Effect.catchTags({
        DatabaseError: () => Effect.fail(unavailable()),
        NotFoundError: () => Effect.fail(missing()),
      }),
    )

    return yield* Schema.decodeUnknownEffect(PublicMixResult)({
      endpoint,
      mix: {
        audioId: mix.id,
        slug: mix.slug,
        title: mix.title,
        description: mix.description,
        createdAt: mix.createdAt.toISOString(),
        updatedAt: mix.updatedAt.toISOString(),
        reviewUrl: new URL(`/mixes/${encodeURIComponent(mix.slug)}`, config.frontendUrl).href,
      },
    }).pipe(Effect.mapError(unavailable), Effect.flatMap(boundResult))
  })

  const getPublicProfile = Effect.fn('PublicResearch.profile')(function* (
    input: typeof PublicProfileInput.Type,
  ) {
    yield* authorization.requireScopes(['content:read'])

    const profile = yield* profiles.getPublicProfileMetadata(input.username).pipe(
      Effect.catchTags({
        DatabaseError: () => Effect.fail(unavailable()),
        NotFoundError: () => Effect.fail(missing()),
      }),
    )

    return yield* Schema.decodeUnknownEffect(PublicProfileResult)({
      endpoint,
      profile: {
        kind: profile.kind,
        id: profile.id,
        name: profile.name,
        username: profile.username,
        bio: profile.bio,
        createdAt: profile.createdAt.toISOString(),
      },
    }).pipe(Effect.mapError(unavailable), Effect.flatMap(boundResult))
  })

  const getPublicCollection = Effect.fn('PublicResearch.collection')(function* (
    input: typeof PublicCollectionInput.Type,
  ) {
    yield* authorization.requireScopes(['content:read'])

    const page = yield* publicListeningCollectionPage(input.collectionId, {
      limit: input.limit ?? 20,
      offset: input.offset ?? 0,
    }).pipe(
      Effect.provideService(Database, db),
      Effect.mapError((error) => (error.reason === 'not-found' ? missing() : unavailable())),
    )

    return yield* Schema.decodeUnknownEffect(PublicCollectionResult)({ endpoint, ...page }).pipe(
      Effect.mapError(unavailable),
      Effect.flatMap(boundResult),
    )
  })

  return { searchCatalogue, getMix, getPublicProfile, getPublicCollection }
})

/** Four metadata-only public research operations, each enforcing the live listener grant. */
export class PublicResearchService extends Context.Service<
  PublicResearchService,
  Effect.Success<typeof makeResearch>
>()('gbfm/mcp/PublicResearchService') {}

/** Requires SearchService, AudioService, ProfileService, Database and EditorialMcpConfig. */
export const PublicResearchServiceLayer = Layer.effect(PublicResearchService, makeResearch).pipe(
  Layer.provide(McpAuthorizationLive),
)
