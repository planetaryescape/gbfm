import { MusicWritePreconditionRequired, MusicServiceUnavailableResponse } from '@gbfm/api/music'
import { Clock, Effect, Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'

import { makeSessionCommandAuthority } from '@/mcp/command-authority'
import { McpOperationStore } from '@/mcp/operations/store'
import {
  MusicWriteError,
  type MusicWriteRequest,
  MusicWriteStoredOutcome,
  MusicWriteStoreResult,
} from '@/services/music-entity/write-intent'

/** Session-only composition: neither wire input nor the domain receives credentials. */
export const musicBodyWriteRequest = Effect.fn('musicHttp.writeRequest')(function* (input: {
  readonly expectedRevision?: number | undefined
  readonly requestId?: string | undefined
  readonly references?: MusicWriteRequest['references'] | undefined
}) {
  if (input.expectedRevision === undefined || input.requestId === undefined)
    return yield* new MusicWritePreconditionRequired({
      message: 'An observed revision and request ID are required.',
    })

  const authority = yield* makeSessionCommandAuthority
  const store = yield* McpOperationStore
  const now = yield* Clock.currentTimeMillis

  return {
    intent: { expectedRevision: input.expectedRevision, requestId: input.requestId },
    references: input.references ?? [],
    context: {
      now,
      checkpoint: authority.checkpoint(['catalogue:write']).pipe(
        Effect.mapError(
          (error) =>
            new MusicWriteError({
              code: error.code === 'access_denied' ? 'access_denied' : 'unavailable',
              message: 'Music write authorization failed.',
            }),
        ),
      ),
      execute: async (request) =>
        Schema.decodeUnknownSync(MusicWriteStoreResult)(
          await store.execute({
            ...request,
            authorize: (outcome) =>
              request.authorize(
                outcome === undefined
                  ? undefined
                  : Schema.decodeUnknownSync(MusicWriteStoredOutcome)(outcome),
              ),
          }),
        ),
    },
  } satisfies MusicWriteRequest
})

export const musicHeaderWriteRequest = (headers: {
  readonly 'x-gbfm-music-revision'?: string | undefined
  readonly 'x-gbfm-request-id'?: string | undefined
}) =>
  musicBodyWriteRequest({
    expectedRevision:
      headers['x-gbfm-music-revision'] === undefined
        ? undefined
        : Number(headers['x-gbfm-music-revision']),
    requestId: headers['x-gbfm-request-id'],
  })

export const mapMusicWriteErrors = <A, R>(effect: Effect.Effect<A, MusicWriteError, R>) =>
  effect.pipe(
    Effect.catchTag('MusicWriteError', (error: MusicWriteError) => {
      const errors = {
        precondition_required: new MusicWritePreconditionRequired({ message: error.message }),
        not_found: new HttpApiError.NotFound(),
        access_denied: new HttpApiError.Forbidden(),
        invalid_input: new HttpApiError.BadRequest(),
        conflict: new HttpApiError.Conflict(),
        expired: new HttpApiError.Conflict(),
        unavailable: new MusicServiceUnavailableResponse({ retryAfterSeconds: 1 }),
      }

      return Effect.fail(errors[error.code])
    }),
  )
