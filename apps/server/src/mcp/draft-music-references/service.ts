import { draftMusicTargetKey, parseDraftMusicReferences } from '@gbfm/core/post-music-references'
import { Clock, Context, Effect, Layer, Option, Schema } from 'effect'

import { Database } from '@/db/layer'

import { McpAuthorization, McpAuthorizationLive } from '../authorization'
import { EditorialToolError } from '../contracts'
import { EditorialMcpConfig } from '../editorial'
import { boundEditorialResult } from '../editorial-music/content'
import { ReferenceWriteResult } from '../editorial-music/contracts'
import {
  checkpointEditorialCommand,
  editorialConflict,
  editorialOperationKeys,
  loadOwnedEditorialDraft,
  replayEditorialOperation,
  saveEditorialChange,
} from '../editorial-music/save'
import {
  draftMusicTargetsGuard,
  maskReferenceWriteResult,
  projectReferenceWriteResult,
  readDraftMusicTarget,
} from '../editorial-music/targets'
import { projectPost, unavailable } from '../model'
import { SetDraftMusicReferencesInput } from './contracts'

const invalid = () =>
  new EditorialToolError({ code: 'invalid_input', message: 'Invalid draft music references.' })

const makeDraftMusicReferences = Effect.gen(function* () {
  const db = yield* Database
  const authorization = yield* McpAuthorization
  const config = yield* EditorialMcpConfig
  const scopes = ['posts:read', 'drafts:write', 'catalogue:read'] as const

  const authorize = authorization
    .requireScopes(scopes)
    .pipe(
      Effect.flatMap((actor) =>
        checkpointEditorialCommand(scopes, actor.userId).pipe(
          Effect.map((checkpoint) => ({ ...actor, liveGuard: checkpoint.liveGuard })),
        ),
      ),
    )

  const setDraftMusicReferences = Effect.fn('DraftMusicReferences.set')(function* (
    raw: typeof SetDraftMusicReferencesInput.Type,
  ) {
    // Authorize before target parsing/lookup; all nested fields are decoded strictly below.
    const actor = yield* authorize

    const input = yield* Schema.decodeUnknownEffect(SetDraftMusicReferencesInput, {
      onExcessProperty: 'error',
    })(raw).pipe(Effect.mapError(invalid))

    const submitted = input.musicReferences

    const key = yield* editorialOperationKeys(
      actor.userId,
      input.requestId,
      JSON.stringify([
        'set_draft_music_references',
        input.postId,
        input.expectedVersion,
        submitted.references.map(draftMusicTargetKey),
        submitted.primary === null ? null : draftMusicTargetKey(submitted.primary),
      ]),
    )

    const replay = replayEditorialOperation(
      db,
      actor.userId,
      key,
      ReferenceWriteResult,
      authorize,
      (result) => maskReferenceWriteResult(db, result),
    )

    const existing = yield* replay

    if (Option.isSome(existing)) return existing.value

    const previous = yield* loadOwnedEditorialDraft(db, input.postId, actor.userId)

    if ((yield* projectPost(previous, config)).version !== input.expectedVersion) {
      const concurrent = yield* replay

      if (Option.isSome(concurrent)) return concurrent.value

      return yield* editorialConflict()
    }

    const display = yield* Effect.forEach(
      submitted.references,
      (target) => readDraftMusicTarget(db, target),
      { concurrency: 4 },
    )

    const primary = submitted.primary

    const musicReferences = yield* parseDraftMusicReferences({
      references: display.map((entry) => entry.target),
      primary:
        primary === null
          ? null
          : (display.find(
              (entry) => draftMusicTargetKey(entry.target) === draftMusicTargetKey(primary),
            )?.target ?? primary),
    }).pipe(Effect.mapError(unavailable))

    const now = new Date(Math.max(yield* Clock.currentTimeMillis, previous.updatedAt.getTime() + 1))

    const next = {
      ...previous,
      musicReferences,
      musicReferencesManaged: true,
      updatedAt: now,
      musicEntityType: musicReferences.primary?.entityType ?? null,
      musicEntityId: musicReferences.primary?.entityId ?? null,
    }

    const result = yield* projectReferenceWriteResult(db, next, config).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(ReferenceWriteResult)),
      Effect.mapError(unavailable),
      Effect.flatMap(boundEditorialResult),
    )

    const current = yield* authorize
    yield* saveEditorialChange(
      db,
      actor.userId,
      previous,
      { musicReferences, managed: true },
      {
        ...key,
        actorId: actor.userId,
        postId: previous.id,
        result: JSON.stringify(result),
        createdAt: now,
      },
      draftMusicTargetsGuard(db, musicReferences.references, now),
      current.liveGuard,
    )
    const committed = yield* replay

    if (Option.isNone(committed)) return yield* editorialConflict()

    return committed.value
  })

  return { setDraftMusicReferences }
})

/** E3 adapter only. P1 owns production registration and persisted live-grant fencing. */
export class DraftMusicReferencesService extends Context.Service<
  DraftMusicReferencesService,
  Effect.Success<typeof makeDraftMusicReferences>
>()('gbfm/mcp/DraftMusicReferencesService') {}

/** Requires request-scoped authority; P1 registers this only with authorized reference reads. */
export const DraftMusicReferencesServiceLayer = Layer.effect(
  DraftMusicReferencesService,
  makeDraftMusicReferences,
).pipe(Layer.provide(McpAuthorizationLive))
