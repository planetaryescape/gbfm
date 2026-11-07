import { canReadEditorial, EditorialAccount, EditorialPrincipal } from '@gbfm/core/editorial-mcp'
import { eq } from 'drizzle-orm'
import { Context, Effect, Layer, Option, Schema } from 'effect'

import { user } from '@/db/auth.schema'
import { Database } from '@/db/layer'
import { PostService, PostSourceAccess } from '@/services/post.service'

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
  accessDenied,
  type EditorialMcpSettings,
  EditorialReader,
  notFound,
  PersistedPost,
  projectPost,
  unavailable,
} from './model'

export const EditorialActor = Context.Service<EditorialPrincipal>('gbfm/mcp/EditorialActor')

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
    const db = yield* Database
    const posts = yield* PostService
    const config = yield* EditorialMcpConfig

    const endpoint = yield* Schema.decodeUnknownEffect(EndpointIdentity)(config).pipe(
      Effect.mapError(unavailable),
    )

    const authorize = Effect.gen(function* () {
      const identity = yield* Effect.serviceOption(EditorialActor)

      if (Option.isNone(identity)) return yield* accessDenied()

      const principal = yield* Schema.decodeUnknownEffect(EditorialPrincipal)(identity.value).pipe(
        Effect.mapError(accessDenied),
      )

      const rows = yield* Effect.tryPromise({
        try: () =>
          db
            .select({ role: user.role, banned: user.banned })
            .from(user)
            .where(eq(user.id, principal.userId))
            .limit(1),
        catch: unavailable,
      }).pipe(
        Effect.tapError(() =>
          Effect.logError('editorial.authorization.unavailable', {
            operation: 'account.lookup',
            dependency: 'database',
          }),
        ),
      )

      const account = yield* Schema.decodeUnknownEffect(EditorialAccount)(rows[0]).pipe(
        Effect.mapError(accessDenied),
      )

      if (!canReadEditorial(account)) return yield* accessDenied()

      return yield* Schema.decodeUnknownEffect(EditorialReader)({
        ...principal,
        role: account.role,
      }).pipe(Effect.mapError(accessDenied))
    })

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
)
