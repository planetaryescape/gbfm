import type { PostId, PostVersion } from '@gbfm/core/editorial-mcp'
import {
  DraftMusicReferenceChange,
  type DraftMusicTarget,
  transitionDraftMusicReferences,
} from '@gbfm/core/post-music-references'
import { Clock, Context, Effect, Layer, Option, Schema } from 'effect'

import { Database } from '@/db/layer'
import { validateCanonicalContent } from '@/lib/mdx'
import { validatePostData } from '@/services/post.service'

import { McpAuthorization, McpAuthorizationLive } from '../authorization'
import { EditorialToolError, GetPostResult } from '../contracts'
import { EditorialMcpConfig } from '../editorial'
import { projectPost, unavailable } from '../model'
import {
  boundEditorialResult,
  findMusicMentions,
  insertMusicEmbedSource,
  previewEditorialContent,
  type EditorialSourceInput,
} from './content'
import {
  AttachMusicInput,
  DetachMusicInput,
  DraftReferenceDisplay,
  InsertMusicEmbedInput,
  ReferenceWriteResult,
  SetDraftTagsInput,
} from './contracts'
import {
  editorialConflict,
  editorialOperationKeys,
  loadOwnedEditorialDraft,
  replayEditorialOperation,
  saveEditorialChange,
  type EditorialPatch,
} from './save'
import type { EditorialSnapshot } from './snapshot'
import { draftMusicTargetsGuard, maskReferenceWriteResult, readDraftMusicTarget } from './targets'

const invalid = () =>
  new EditorialToolError({ code: 'invalid_input', message: 'Invalid editorial mutation.' })

const canonicalTarget = (target: DraftMusicTarget): DraftMusicTarget => ({
  entityType: target.entityType,
  entityId: target.entityId.toLowerCase(),
})

const makeEditorialMusic = Effect.gen(function* () {
  const db = yield* Database
  const authorization = yield* McpAuthorization
  const config = yield* EditorialMcpConfig
  const write = authorization.requireScopes(['posts:read', 'drafts:write'])
  const musicWrite = authorization.requireScopes(['posts:read', 'drafts:write', 'catalogue:read'])

  const endpoint = {
    environment: config.environment,
    resourceUrl: config.resourceUrl,
    frontendUrl: config.frontendUrl,
  }

  const mutate = <A extends { readonly post: { readonly postId: PostId } }>(
    input: {
      readonly requestId: string
      readonly postId: PostId
      readonly expectedVersion: PostVersion
    },
    operation: string,
    normalizedInput: string,
    authorize: typeof write,
    prepare: (previous: EditorialSnapshot) => Effect.Effect<
      {
        readonly patch: EditorialPatch
        readonly targets: ReadonlyArray<DraftMusicTarget>
      },
      EditorialToolError
    >,
    resultSchema: Schema.Codec<A, unknown>,
    project: (next: EditorialSnapshot) => Effect.Effect<A, EditorialToolError>,
    mask: (result: A) => Effect.Effect<A, EditorialToolError> = Effect.succeed,
  ) =>
    Effect.gen(function* () {
      const actor = yield* authorize

      const key = yield* editorialOperationKeys(
        actor.userId,
        input.requestId,
        JSON.stringify([operation, normalizedInput]),
      )

      const replay = replayEditorialOperation(db, actor.userId, key, resultSchema, authorize, mask)
      const existing = yield* replay

      if (Option.isSome(existing)) return existing.value
      const previous = yield* loadOwnedEditorialDraft(db, input.postId, actor.userId)

      if ((yield* projectPost(previous, config)).version !== input.expectedVersion) {
        const concurrent = yield* replay

        if (Option.isSome(concurrent)) return concurrent.value

        return yield* editorialConflict()
      }

      const { patch, targets } = yield* prepare(previous)

      const now = new Date(
        Math.max(yield* Clock.currentTimeMillis, previous.updatedAt.getTime() + 1),
      )

      const next = {
        ...previous,
        ...patch,
        title: patch.title ?? previous.title,
        content: patch.content ?? previous.content,
        description: patch.description === undefined ? previous.description : patch.description,
        updatedAt: now,
        musicReferencesManaged:
          patch.musicReferences === undefined
            ? previous.musicReferencesManaged
            : (patch.managed ?? true),
        musicReferences: patch.musicReferences ?? previous.musicReferences,
        musicEntityType:
          patch.musicReferences === undefined
            ? previous.musicEntityType
            : (patch.musicReferences.primary?.entityType ?? null),
        musicEntityId:
          patch.musicReferences === undefined
            ? previous.musicEntityId
            : (patch.musicReferences.primary?.entityId ?? null),
      }

      yield* validatePostData({ type: next.type, title: next.title, content: next.content }).pipe(
        Effect.mapError(invalid),
      )
      yield* validateCanonicalContent(next.content).pipe(Effect.mapError(invalid))

      const result = yield* project(next).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(resultSchema)),
        Effect.mapError(unavailable),
        Effect.flatMap(boundEditorialResult),
      )

      yield* authorize
      yield* saveEditorialChange(
        db,
        actor.userId,
        previous,
        patch,
        {
          ...key,
          actorId: actor.userId,
          postId: previous.id,
          result: JSON.stringify(result),
          createdAt: now,
        },
        draftMusicTargetsGuard(db, targets, now),
      )
      const committed = yield* replay

      if (Option.isNone(committed)) return yield* editorialConflict()

      return committed.value
    })

  const projectText = (next: EditorialSnapshot) =>
    projectPost(next, config).pipe(Effect.map((post) => ({ endpoint, post })))

  const projectReferences = (next: EditorialSnapshot) =>
    Effect.gen(function* () {
      const post = yield* projectPost(next, config)

      const display = yield* Effect.forEach(
        next.musicReferences.references,
        (target) =>
          readDraftMusicTarget(db, target).pipe(
            Effect.catchTag('EditorialToolError', (error) =>
              error.code === 'not_found'
                ? Effect.succeed(DraftReferenceDisplay.cases.Unavailable.make({ target }))
                : Effect.fail(error),
            ),
          ),
        { concurrency: 4 },
      )

      return { endpoint, post: { ...post, musicReferences: { ...next.musicReferences, display } } }
    })

  const attachMusic = Effect.fn('EditorialMusic.attach')(function* (
    raw: typeof AttachMusicInput.Type,
  ) {
    const input = yield* Schema.decodeUnknownEffect(AttachMusicInput, {
      onExcessProperty: 'error',
    })(raw).pipe(Effect.mapError(invalid))

    const target = canonicalTarget(input.target)

    return yield* mutate(
      input,
      'attach_music_to_draft',
      JSON.stringify({ ...input, target }),
      musicWrite,
      (previous) =>
        Effect.gen(function* () {
          yield* readDraftMusicTarget(db, target)

          const state = yield* transitionDraftMusicReferences(
            { musicReferences: previous.musicReferences, managed: previous.musicReferencesManaged },
            DraftMusicReferenceChange.cases.Attach.make({
              target,
              position: input.position,
              primary: input.primary,
            }),
          ).pipe(Effect.mapError(invalid))

          return {
            patch: { musicReferences: state.musicReferences, managed: state.managed },
            targets: [target],
          }
        }),
      ReferenceWriteResult,
      projectReferences,
      (result) => maskReferenceWriteResult(db, result),
    )
  })

  const detachMusic = Effect.fn('EditorialMusic.detach')(function* (
    raw: typeof DetachMusicInput.Type,
  ) {
    const input = yield* Schema.decodeUnknownEffect(DetachMusicInput, {
      onExcessProperty: 'error',
    })(raw).pipe(Effect.mapError(invalid))

    const target = canonicalTarget(input.target)
    const primary = input.primary === null ? null : canonicalTarget(input.primary)

    return yield* mutate(
      input,
      'detach_music_from_draft',
      JSON.stringify({ ...input, target, primary }),
      musicWrite,
      (previous) =>
        Effect.gen(function* () {
          if (primary !== null) yield* readDraftMusicTarget(db, primary)

          const state = yield* transitionDraftMusicReferences(
            { musicReferences: previous.musicReferences, managed: previous.musicReferencesManaged },
            DraftMusicReferenceChange.cases.Remove.make({ target, primary }),
          ).pipe(Effect.mapError(invalid))

          return {
            patch: { musicReferences: state.musicReferences, managed: state.managed },
            targets: primary === null ? [] : [primary],
          }
        }),
      ReferenceWriteResult,
      projectReferences,
      (result) => maskReferenceWriteResult(db, result),
    )
  })

  const insertMusicEmbed = Effect.fn('EditorialMusic.insertEmbed')(function* (
    raw: typeof InsertMusicEmbedInput.Type,
  ) {
    const input = yield* Schema.decodeUnknownEffect(InsertMusicEmbedInput, {
      onExcessProperty: 'error',
    })(raw).pipe(Effect.mapError(invalid))

    const target = canonicalTarget(input.target)

    return yield* mutate(
      input,
      'insert_music_embed',
      JSON.stringify({ ...input, target }),
      musicWrite,
      (previous) =>
        Effect.gen(function* () {
          yield* readDraftMusicTarget(db, target)
          const next = yield* insertMusicEmbedSource(previous.content ?? '', target, input.offset)

          return { patch: { content: next }, targets: [target] }
        }),
      GetPostResult,
      projectText,
    )
  })

  const setDraftTags = Effect.fn('EditorialMusic.setTags')(function* (
    raw: typeof SetDraftTagsInput.Type,
  ) {
    const input = yield* Schema.decodeUnknownEffect(SetDraftTagsInput, {
      onExcessProperty: 'error',
    })(raw).pipe(Effect.mapError(invalid))

    return yield* mutate(
      input,
      'set_draft_tags',
      JSON.stringify(input),
      write,
      () => Effect.succeed({ patch: { tags: input.tags }, targets: [] }),
      GetPostResult,
      projectText,
    )
  })

  const findMentions = Effect.fn('EditorialMusic.findMentions')(function* (
    input: typeof EditorialSourceInput.Type,
  ) {
    yield* authorization.editorial()

    return yield* findMusicMentions(input)
  })

  const preview = Effect.fn('EditorialMusic.preview')(function* (
    input: typeof EditorialSourceInput.Type,
  ) {
    yield* authorization.editorial()

    return yield* previewEditorialContent(input)
  })

  return { attachMusic, detachMusic, insertMusicEmbed, setDraftTags, findMentions, preview }
})

/** Draft-only commands; central MCP composition remains owned by P1. */
export class EditorialMusicService extends Context.Service<
  EditorialMusicService,
  Effect.Success<typeof makeEditorialMusic>
>()('gbfm/mcp/EditorialMusicService') {}

/** Uses existing live account/scope authorization and the shipped editorial receipt ledger. */
export const EditorialMusicServiceLayer = Layer.effect(
  EditorialMusicService,
  makeEditorialMusic,
).pipe(Layer.provide(McpAuthorizationLive))
