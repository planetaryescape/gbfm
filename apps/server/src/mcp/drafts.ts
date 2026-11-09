import { EDITORIAL_DRAFT_RETRY_WINDOW_MS, PostId } from '@gbfm/core/editorial-mcp'
import { Clock, Context, Effect, Layer, Option, Schema } from 'effect'

import { Database } from '@/db/layer'
import { validateCanonicalContent } from '@/lib/mdx'
import { PostService, PostSourceAccess, validatePostData } from '@/services/post.service'

import { McpAuthorization, McpAuthorizationLive } from './authorization'
import { CreateDraftInput, EditorialToolError, GetPostResult, UpdateDraftInput } from './contracts'
import { insertEditorialDraft, readEditorialReceipt, updateEditorialDraft } from './draft-store'
import { EditorialMcpConfig } from './editorial'
import { boundEditorialWireResult } from './editorial-music/content'
import { checkpointEditorialCommand } from './editorial-music/save'
import { loadEditorialSnapshot } from './editorial-music/snapshot'
import { PersistedPost, projectPost, unavailable, notFound } from './model'

const conflict = () =>
  new EditorialToolError({
    code: 'conflict',
    message: 'Draft changed or requestId was reused. Read the draft before retrying.',
  })

const invalid = () =>
  new EditorialToolError({ code: 'invalid_input', message: 'Invalid draft content or fields.' })

const hash = Effect.fn('EditorialDraftService.hash')(function* (value: string) {
  const digest = yield* Effect.tryPromise({
    try: () => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
    catch: unavailable,
  })

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
})

export class EditorialDraftService extends Context.Service<
  EditorialDraftService,
  {
    readonly createDraft: (
      input: typeof CreateDraftInput.Type,
    ) => Effect.Effect<typeof GetPostResult.Type, EditorialToolError>
    readonly updateDraft: (
      input: typeof UpdateDraftInput.Type,
    ) => Effect.Effect<typeof GetPostResult.Type, EditorialToolError>
  }
>()('gbfm/mcp/EditorialDraftService') {}

export const EditorialDraftServiceLayer = Layer.effect(
  EditorialDraftService,
  Effect.gen(function* () {
    const db = yield* Database
    const authorization = yield* McpAuthorization
    const posts = yield* PostService
    const config = yield* EditorialMcpConfig

    const authorize = authorization
      .editorial(true)
      .pipe(
        Effect.flatMap((actor) =>
          checkpointEditorialCommand(['posts:read', 'drafts:write'], actor.userId).pipe(
            Effect.map((checkpoint) => ({ ...actor, liveGuard: checkpoint.liveGuard })),
          ),
        ),
      )

    const loadDraft = Effect.fn('EditorialDraftService.loadDraft')(function* (
      postId: PostId,
      actor: Effect.Success<typeof authorize>,
    ) {
      yield* posts
        .getSourceById(
          postId,
          PostSourceAccess.cases.Authored.make({ userId: actor.userId, userRole: actor.role }),
        )
        .pipe(
          Effect.catchTags({
            DatabaseError: () => Effect.fail(unavailable()),
            NotFoundError: () => Effect.fail(notFound()),
          }),
        )

      const post = yield* loadEditorialSnapshot(db, postId)

      if (
        !post.draft ||
        post.type !== 'post' ||
        !post.creators?.some((creator) => creator.id === actor.userId)
      )
        return yield* notFound()

      return post
    })

    const replay = Effect.fn('EditorialDraftService.replay')(function* (
      id: string,
      inputHash: string,
      actor: Effect.Success<typeof authorize>,
    ) {
      yield* authorize

      const [row] = yield* Effect.tryPromise({
        try: () => readEditorialReceipt(db, id, actor.userId),
        catch: unavailable,
      })

      if (!row) return Option.none()

      if (row.inputHash !== inputHash) return yield* conflict()

      const receipt = yield* Schema.decodeUnknownEffect(
        Schema.Struct({
          postId: PostId,
          result: Schema.NullOr(Schema.String),
          createdAt: Schema.Date,
        }),
      )(row).pipe(Effect.mapError(unavailable))

      if (
        receipt.result === null ||
        (yield* Clock.currentTimeMillis) >=
          receipt.createdAt.getTime() + EDITORIAL_DRAFT_RETRY_WINDOW_MS
      )
        return yield* new EditorialToolError({
          code: 'expired',
          message:
            'The 24-hour retry window expired. Read the current draft and use a new requestId for a new edit.',
        })

      const result = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(GetPostResult))(
        receipt.result,
      ).pipe(Effect.mapError(unavailable))

      if (receipt.postId !== result.post.postId) return yield* unavailable()
      yield* loadDraft(receipt.postId, actor)
      yield* authorize

      return Option.some(yield* boundEditorialWireResult(result))
    })

    const createDraft = Effect.fn('EditorialDraftService.createDraft')(function* (
      raw: typeof CreateDraftInput.Type,
    ) {
      const actor = yield* authorize

      const input = yield* Schema.decodeUnknownEffect(CreateDraftInput, {
        onExcessProperty: 'error',
      })(raw).pipe(Effect.mapError(invalid))

      yield* validatePostData({ type: 'post', title: input.title, content: input.content }).pipe(
        Effect.mapError(invalid),
      )
      yield* validateCanonicalContent(input.content).pipe(Effect.mapError(invalid))
      const id = yield* hash(JSON.stringify([actor.userId, input.requestId]))

      const inputHash = yield* hash(
        JSON.stringify(['create', input.title, input.content, input.description ?? null]),
      )

      const existing = yield* replay(id, inputHash, actor)

      if (Option.isSome(existing)) return existing.value

      const postId = yield* Schema.decodeUnknownEffect(PostId)(crypto.randomUUID()).pipe(
        Effect.mapError(unavailable),
      )

      const now = new Date(yield* Clock.currentTimeMillis)

      const post = yield* Schema.decodeUnknownEffect(PersistedPost)({
        id: postId,
        slug: postId,
        type: 'post',
        title: input.title,
        content: input.content,
        description: input.description ?? null,
        draft: true,
        createdAt: now,
        updatedAt: now,
        thumbnailUrl: null,
        bannerImageUrl: null,
        musicEntityType: null,
        musicEntityId: null,
        musicReferencesManaged: false,
        musicReferences: { references: [], primary: null },
        parentPostId: null,
        rootPostId: null,
        quotedPostId: null,
        depth: 0,
        tags: null,
        creators: [{ id: actor.userId }],
      }).pipe(Effect.mapError(unavailable))

      const result = {
        endpoint: {
          environment: config.environment,
          resourceUrl: config.resourceUrl,
          frontendUrl: config.frontendUrl,
        },
        post: yield* projectPost(post, config),
      }

      yield* boundEditorialWireResult(result)

      const receipt = {
        id,
        actorId: actor.userId,
        postId,
        inputHash,
        result: JSON.stringify(result),
        createdAt: now,
      }

      const current = yield* authorize
      yield* Effect.tryPromise({
        try: () =>
          insertEditorialDraft(db, actor.userId, postId, input, now, receipt, current.liveGuard),
        catch: unavailable,
      })
      const committed = yield* replay(id, inputHash, actor)

      if (Option.isNone(committed)) return yield* conflict()

      return committed.value
    })

    const updateDraft = Effect.fn('EditorialDraftService.updateDraft')(function* (
      raw: typeof UpdateDraftInput.Type,
    ) {
      const actor = yield* authorize

      const input = yield* Schema.decodeUnknownEffect(UpdateDraftInput, {
        onExcessProperty: 'error',
      })(raw).pipe(Effect.mapError(invalid))

      if (input.content !== undefined)
        yield* validateCanonicalContent(input.content).pipe(Effect.mapError(invalid))
      const id = yield* hash(JSON.stringify([actor.userId, input.requestId]))

      const inputHash = yield* hash(
        JSON.stringify([
          'update',
          {
            postId: input.postId,
            expectedVersion: input.expectedVersion,
            title: input.title,
            content: input.content,
            description: input.description,
          },
        ]),
      )

      const existing = yield* replay(id, inputHash, actor)

      if (Option.isSome(existing)) return existing.value
      const previous = yield* loadDraft(input.postId, actor)
      const projection = yield* projectPost(previous, config)

      if (projection.version !== input.expectedVersion) {
        const concurrent = yield* replay(id, inputHash, actor)

        if (Option.isSome(concurrent)) return concurrent.value

        return yield* conflict()
      }

      const now = new Date(
        Math.max(yield* Clock.currentTimeMillis, previous.updatedAt.getTime() + 1),
      )

      const next = {
        ...previous,
        updatedAt: now,
        title: input.title ?? previous.title,
        content: input.content ?? previous.content,
        description: input.description === undefined ? previous.description : input.description,
      }

      yield* validatePostData({ type: next.type, title: next.title, content: next.content }).pipe(
        Effect.mapError(invalid),
      )

      const result = {
        endpoint: {
          environment: config.environment,
          resourceUrl: config.resourceUrl,
          frontendUrl: config.frontendUrl,
        },
        post: yield* projectPost(next, config),
      }

      yield* boundEditorialWireResult(result)

      const receipt = {
        id,
        actorId: actor.userId,
        postId: input.postId,
        inputHash,
        result: JSON.stringify(result),
        createdAt: now,
      }

      const current = yield* authorize
      yield* updateEditorialDraft(
        db,
        actor.userId,
        previous,
        input,
        now,
        receipt,
        current.liveGuard,
      )
      const committed = yield* replay(id, inputHash, actor)

      if (Option.isNone(committed)) return yield* conflict()

      return committed.value
    })

    return EditorialDraftService.of({ createDraft, updateDraft })
  }),
).pipe(Layer.provide(McpAuthorizationLive))
