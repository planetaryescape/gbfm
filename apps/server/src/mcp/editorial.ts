import { Context, Effect, Layer, Schema } from 'effect'

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
import {
  type EditorialMcpSettings,
  notFound,
  PersistedPost,
  projectPost,
  unavailable,
} from './model'

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

      const persisted = yield* Schema.decodeUnknownEffect(Schema.Array(PersistedPost))(
        result.data,
      ).pipe(Effect.mapError(unavailable))

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
      }).pipe(Effect.mapError(unavailable))
    })

    const getPost = Effect.fn('EditorialReadService.getPost')(function* (
      input: typeof GetPostInput.Type,
    ) {
      const actor = yield* authorize

      const loaded = yield* posts
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

      const post = yield* Schema.decodeUnknownEffect(PersistedPost)(loaded).pipe(
        Effect.mapError(unavailable),
      )

      if (post.id !== input.postId) return yield* notFound()

      return yield* Schema.decodeUnknownEffect(GetPostResult)({
        endpoint,
        post: yield* projectPost(post, config),
      }).pipe(Effect.mapError(unavailable))
    })

    return EditorialReadService.of({ listDrafts, getPost })
  }),
).pipe(Layer.provide(McpAuthorizationLive))
