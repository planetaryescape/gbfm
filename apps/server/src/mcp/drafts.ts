import {
  canReadEditorial,
  EditorialAccount,
  EditorialPrincipal,
  PostId,
} from '@gbfm/core/editorial-mcp'
import { eq } from 'drizzle-orm'
import { Clock, Context, Effect, Layer, Option, Schema } from 'effect'

import { user } from '@/db/auth.schema'
import { Database } from '@/db/layer'
import { validateCanonicalContent } from '@/lib/mdx'
import { PostService, PostSourceAccess, validatePostData } from '@/services/post.service'

import { CreateDraftInput, EditorialToolError, GetPostResult, UpdateDraftInput } from './contracts'
import { insertEditorialDraft, readEditorialReceipt, updateEditorialDraft } from './draft-store'
import { EditorialActor, EditorialMcpConfig } from './editorial'
import { PersistedPost, projectPost, unavailable, notFound } from './model'

const denied = () =>
  new EditorialToolError({ code: 'access_denied', message: 'Draft-write access denied.' })

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
    const posts = yield* PostService
    const config = yield* EditorialMcpConfig

    const authorize = Effect.gen(function* () {
      const identity = yield* Effect.serviceOption(EditorialActor)

      if (Option.isNone(identity)) return yield* denied()

      const principal = yield* Schema.decodeUnknownEffect(EditorialPrincipal)(identity.value).pipe(
        Effect.mapError(denied),
      )

      if (!principal.scopes.includes('drafts:write')) return yield* denied()

      const [row] = yield* Effect.tryPromise({
        try: () =>
          db
            .select({ role: user.role, banned: user.banned })
            .from(user)
            .where(eq(user.id, principal.userId))
            .limit(1),
        catch: unavailable,
      })

      const account = yield* Schema.decodeUnknownEffect(EditorialAccount)(row).pipe(
        Effect.mapError(denied),
      )

      if (!canReadEditorial(account)) return yield* denied()

      return { ...principal, role: account.role }
    })

    const loadDraft = Effect.fn('EditorialDraftService.loadDraft')(function* (
      postId: PostId,
      actor: Effect.Success<typeof authorize>,
    ) {
      const loaded = yield* posts
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

      const post = yield* Schema.decodeUnknownEffect(PersistedPost)(loaded).pipe(
        Effect.mapError(unavailable),
      )

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
      const [row] = yield* Effect.tryPromise({
        try: () => readEditorialReceipt(db, id, actor.userId),
        catch: unavailable,
      })

      if (!row) return Option.none()

      if (row.inputHash !== inputHash) return yield* conflict()

      const receipt = yield* Schema.decodeUnknownEffect(
        Schema.Struct({
          postId: PostId,
          result: Schema.fromJsonString(GetPostResult),
        }),
      )(row).pipe(Effect.mapError(unavailable))

      if (receipt.postId !== receipt.result.post.postId) return yield* unavailable()
      yield* loadDraft(receipt.postId, actor)

      return Option.some(receipt.result)
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

      const postId = yield* Schema.decodeUnknownEffect(PostId)(`mcp-${id}`).pipe(
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

      const receipt = {
        id,
        actorId: actor.userId,
        postId,
        inputHash,
        result: JSON.stringify(result),
        createdAt: now,
      }

      yield* Effect.tryPromise({
        try: () => insertEditorialDraft(db, actor.userId, postId, input, now, receipt),
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

      const receipt = {
        id,
        actorId: actor.userId,
        postId: input.postId,
        inputHash,
        result: JSON.stringify(result),
        createdAt: now,
      }

      yield* Effect.tryPromise({
        try: () => updateEditorialDraft(db, actor.userId, previous, input, now, receipt),
        catch: unavailable,
      })
      const committed = yield* replay(id, inputHash, actor)

      if (Option.isNone(committed)) return yield* conflict()

      return committed.value
    })

    return EditorialDraftService.of({ createDraft, updateDraft })
  }),
)
