import { Context, Effect, Layer, Schema } from 'effect'

import { PostService } from '@/services/post.service'
import { ShowService } from '@/services/show.service'

import { McpAuthorization, McpAuthorizationLive } from '../authorization'
import { EditorialToolError, EndpointIdentity } from '../contracts'
import { EditorialMcpConfig } from '../editorial'
import {
  type ContentPageInput,
  PublishedPostsResult,
  type PublicShowInput,
  PublicShowResult,
  type ShowEpisodesInput,
  ShowEpisodesResult,
} from './contracts'

const unavailable = () =>
  new EditorialToolError({ code: 'unavailable', message: 'Public content is unavailable.' })

const boundResult = <A>(result: A) =>
  new TextEncoder().encode(JSON.stringify(result)).byteLength > 256 * 1024
    ? Effect.fail(unavailable())
    : Effect.succeed(result)

const notFound = () => new EditorialToolError({ code: 'not_found', message: 'Content not found.' })

const makeContentReads = Effect.gen(function* () {
  const authorization = yield* McpAuthorization
  const posts = yield* PostService
  const shows = yield* ShowService
  const config = yield* EditorialMcpConfig

  const endpoint = yield* Schema.decodeUnknownEffect(EndpointIdentity)(config).pipe(
    Effect.mapError(unavailable),
  )

  const listPublishedPosts = Effect.fn('ContentRead.listPublishedPosts')(function* (
    input: typeof ContentPageInput.Type,
  ) {
    yield* authorization.requireScopes(['content:read'])

    // Deliberately omit readerId: owning a draft does not make it public through MCP.
    const result = yield* posts
      .getEditorialSummaries({ limit: input.limit ?? 20, offset: input.offset ?? 0 })
      .pipe(Effect.mapError(unavailable))

    const output = yield* Schema.decodeUnknownEffect(PublishedPostsResult)({
      endpoint,
      posts: result.data.map((post) => ({
        postId: post.id,
        slug: post.slug,
        title: post.title,
        description: post.description,
        createdAt: post.createdAt.toISOString(),
        updatedAt: post.updatedAt.toISOString(),
        reviewUrl: new URL(`/editorial/${encodeURIComponent(post.slug)}`, config.frontendUrl).href,
      })),
      pagination: result.pagination,
    }).pipe(Effect.mapError(unavailable))

    return yield* boundResult(output)
  })

  const getShow = Effect.fn('ContentRead.getShow')(function* (input: typeof PublicShowInput.Type) {
    yield* authorization.requireScopes(['content:read'])

    const show = yield* shows.getPublicSummaryBySlug(input.slug).pipe(
      Effect.catchTags({
        DatabaseError: () => Effect.fail(unavailable()),
        NotFoundError: () => Effect.fail(notFound()),
      }),
    )

    return yield* Schema.decodeUnknownEffect(PublicShowResult)({
      endpoint,
      show: {
        showId: show.id,
        slug: show.slug,
        title: show.title,
        description: show.description,
        createdAt: show.createdAt.toISOString(),
        updatedAt: show.updatedAt.toISOString(),
        reviewUrl: new URL(`/shows/${encodeURIComponent(show.slug)}`, config.frontendUrl).href,
      },
    }).pipe(Effect.mapError(unavailable), Effect.flatMap(boundResult))
  })

  const listShowEpisodes = Effect.fn('ContentRead.listShowEpisodes')(function* (
    input: typeof ShowEpisodesInput.Type,
  ) {
    yield* authorization.requireScopes(['content:read'])

    // Never pass the MCP principal, even for admins: this is the anonymous public seam.
    const result = yield* shows
      .getEpisodes(input.slug, { limit: input.limit ?? 20, offset: input.offset ?? 0 })
      .pipe(
        Effect.catchTags({
          DatabaseError: () => Effect.fail(unavailable()),
          NotFoundError: () => Effect.fail(notFound()),
        }),
      )

    return yield* Schema.decodeUnknownEffect(ShowEpisodesResult)({
      endpoint,
      episodes: result.data.map((episode) => ({
        audioId: episode.id,
        type: episode.type,
        slug: episode.slug,
        title: episode.title,
        description: episode.description,
        createdAt: episode.createdAt.toISOString(),
        updatedAt: episode.updatedAt.toISOString(),
        reviewUrl: new URL(
          episode.type === 'misc'
            ? `/shows/${encodeURIComponent(input.slug)}`
            : `/${episode.type === 'mix' ? 'mixes' : 'tracks'}/${encodeURIComponent(episode.slug)}`,
          config.frontendUrl,
        ).href,
      })),
      pagination: result.pagination,
    }).pipe(Effect.mapError(unavailable), Effect.flatMap(boundResult))
  })

  return { listPublishedPosts, getShow, listShowEpisodes }
})

/** Public research reads; every entry point rechecks the current account and content grant. */
export class ContentReadService extends Context.Service<
  ContentReadService,
  Effect.Success<typeof makeContentReads>
>()('gbfm/mcp/ContentReadService') {}

/** Requires PostService, ShowService and endpoint configuration; no external resolver is invoked. */
export const ContentReadServiceLayer = Layer.effect(ContentReadService, makeContentReads).pipe(
  Layer.provide(McpAuthorizationLive),
)
