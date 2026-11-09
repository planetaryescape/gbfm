import { Api } from '@gbfm/api/api'
import { AuthSession } from '@gbfm/api/middleware/auth'
import { Effect } from 'effect'
import { HttpApiBuilder, HttpApiError } from 'effect/http-api'

import { CommandAuthority, makeSessionCommandAuthority } from '@/mcp/command-authority'
import { previewListeningImport } from '@/services/listening-import'
import {
  deleteListeningItem,
  editListeningMix,
  listeningLibrary,
  publicListeningCollections,
  saveListeningMixes,
  setListeningMembership,
  writeListeningCollection,
  type ListeningError,
} from '@/services/listening.service'

const respond = <A, R>(effect: Effect.Effect<A, ListeningError, R>) =>
  effect.pipe(
    Effect.mapError((error) => {
      if (error.reason === 'invalid') return new HttpApiError.BadRequest()

      if (error.reason === 'not-found') return new HttpApiError.NotFound()

      if (error.reason === 'conflict') return new HttpApiError.Conflict()

      if (error.reason === 'access-denied') return new HttpApiError.Forbidden()

      return new HttpApiError.ServiceUnavailable()
    }),
  )

const mutate = <R>(effect: Effect.Effect<void, ListeningError, R>) =>
  Effect.gen(function* () {
    const authority = yield* makeSessionCommandAuthority

    return yield* respond(effect).pipe(
      Effect.provideService(CommandAuthority, authority),
      Effect.as({ success: true }),
    )
  })

/** Authenticated mutations never accept an owner ID from the client. */
export const ListeningHandlersLive = HttpApiBuilder.group(Api, 'listening', (handlers) =>
  handlers
    .handle('library', () =>
      Effect.gen(function* () {
        const { user } = yield* AuthSession

        return yield* respond(listeningLibrary(user.id))
      }),
    )
    .handle('preview', ({ payload }) =>
      previewListeningImport(payload.url).pipe(
        Effect.catchTag('ListeningImportError', (error) =>
          Effect.succeed({ items: [], warnings: [error.message] }),
        ),
      ),
    )
    .handle('save', ({ payload }) =>
      Effect.gen(function* () {
        const { user } = yield* AuthSession

        return yield* mutate(saveListeningMixes(user.id, payload))
      }),
    )
    .handle('editMix', ({ params, payload }) =>
      Effect.gen(function* () {
        const { user } = yield* AuthSession

        return yield* mutate(editListeningMix(user.id, params.id, payload))
      }),
    )
    .handle('deleteMix', ({ params, payload }) =>
      Effect.gen(function* () {
        const { user } = yield* AuthSession

        return yield* mutate(
          deleteListeningItem(user.id, params.id, 'mix', payload.expectedVersion),
        )
      }),
    )
    .handle('createCollection', ({ payload }) =>
      Effect.gen(function* () {
        const { user } = yield* AuthSession

        return yield* mutate(writeListeningCollection(user.id, payload))
      }),
    )
    .handle('editCollection', ({ params, payload }) =>
      Effect.gen(function* () {
        const { user } = yield* AuthSession

        return yield* mutate(writeListeningCollection(user.id, payload, params.id))
      }),
    )
    .handle('deleteCollection', ({ params, payload }) =>
      Effect.gen(function* () {
        const { user } = yield* AuthSession

        return yield* mutate(
          deleteListeningItem(user.id, params.id, 'collection', payload.expectedVersion),
        )
      }),
    )
    .handle('membership', ({ params, payload }) =>
      Effect.gen(function* () {
        const { user } = yield* AuthSession

        return yield* mutate(
          setListeningMembership(
            user.id,
            params.id,
            params.mixId,
            payload.included,
            payload.expectedVersion,
          ),
        )
      }),
    )
    .handle('publicCollections', () => respond(publicListeningCollections()))
    .handle('publicCollection', ({ params }) => respond(publicListeningCollections(params.id))),
)
