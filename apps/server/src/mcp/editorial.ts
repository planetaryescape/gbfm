import { PostId } from '@gbfm/core/editorial-mcp'
import { Context, Effect, Layer, Schema } from 'effect'

import { Database } from '@/db/layer'
import { PostService, PostSourceAccess } from '@/services/post.service'

import { McpActor, McpAuthorization, McpAuthorizationLive } from './authorization'
import {
  type EditorialToolError,
  EndpointIdentity,
  type GetPostInput,
  GetPostResult,
  type ListDraftsInput,
  ListDraftsResult,
  PostSummary,
} from './contracts'
import { boundEditorialWireResult } from './editorial-music/content'
import { loadEditorialSnapshot } from './editorial-music/snapshot'
import { type EditorialMcpSettings, notFound, projectPost, unavailable } from './model'

export const EditorialActor = McpActor

export const EditorialMcpConfig = Context.Service<typeof EditorialMcpSettings.Type>(
  'gbfm/mcp/EditorialMcpConfig',
)

export class EditorialReadService extends Context.Service<
  EditorialReadService,
  {
    readonly listDrafts: (
      input: typeof ListDraftsInput.Type,
    ) => Effect.Effect<typeof ListDraftsResult.Type, EditorialToolError>
    readonly getPost: (
      input: typeof GetPostInput.Type,
    ) => Effect.Effect<typeof GetPostResult.Type, EditorialToolError>
  }
>()('gbfm/mcp/EditorialReadService') {}

export const EditorialReadServiceLayer = Layer.effect(
  EditorialReadService,
  Effect.gen(function* () {
    const authorization = yield* McpAuthorization
    const db = yield* Database
    const posts = yield* PostService
    const config = yield* EditorialMcpConfig

    const endpoint = yield* Schema.decodeUnknownEffect(EndpointIdentity)(config).pipe(
      Effect.mapError(unavailable),
    )

    const authorize = authorization.editorial()

    const listDrafts = Effect.fn('EditorialReadService.listDrafts')(function* (
      input: typeof ListDraftsInput.Type,
    ) {
      const actor = yield* authorize

      const result = yield* posts
        .getSourcesForEdit(
          { draft: true, limit: input.limit ?? 20, offset: input.offset ?? 0 },
          PostSourceAccess.cases.Authored.make({ userId: actor.userId, userRole: actor.role }),
        )
        .pipe(Effect.mapError(unavailable))

      const persisted = yield* Effect.forEach(
        result.data,
        (row) =>
          Effect.gen(function* () {
            const id = yield* Schema.decodeUnknownEffect(PostId)(row.id).pipe(
              Effect.mapError(unavailable),
            )

            const post = yield* loadEditorialSnapshot(db, id)

            if (!post.draft || !post.creators?.some((creator) => creator.id === actor.userId))
              return yield* notFound()

            return post
          }),
        { concurrency: 4 },
      )

      const summaries = yield* Effect.forEach(persisted, (post) =>
        projectPost(post, config).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(PostSummary)),
          Effect.mapError(unavailable),
        ),
      )

      return yield* Schema.decodeUnknownEffect(ListDraftsResult)({
        endpoint,
        posts: summaries,
        pagination: result.pagination,
      }).pipe(Effect.mapError(unavailable), Effect.flatMap(boundEditorialWireResult))
    })

    const getPost = Effect.fn('EditorialReadService.getPost')(function* (
      input: typeof GetPostInput.Type,
    ) {
      const actor = yield* authorize

      yield* posts
        .getSourceById(
          input.postId,
          PostSourceAccess.cases.Authored.make({ userId: actor.userId, userRole: actor.role }),
        )
        .pipe(
          Effect.catchTags({
            DatabaseError: () => Effect.fail(unavailable()),
            NotFoundError: () => Effect.fail(notFound()),
          }),
        )

      const post = yield* loadEditorialSnapshot(db, input.postId)

      if (post.draft && !post.creators?.some((creator) => creator.id === actor.userId))
        return yield* notFound()

      return yield* Schema.decodeUnknownEffect(GetPostResult)({
        endpoint,
        post: yield* projectPost(post, config),
      }).pipe(Effect.mapError(unavailable), Effect.flatMap(boundEditorialWireResult))
    })

    return EditorialReadService.of({ listDrafts, getPost })
  }),
).pipe(Layer.provide(McpAuthorizationLive))
