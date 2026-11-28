import { Command, Query } from '@effect/ui'
import { Effect, Layer, Schema } from 'effect'

import {
  SpotifyConnection,
  SpotifyConnectionError,
  SpotifyConnectionLive,
  SpotifyStatus,
} from '../../spotify/connection'
import { SpotifyProviderMessage } from './domain'

export class ReadSpotifyStatus extends Query.Service<ReadSpotifyStatus>()(
  'spotify/ReadSpotifyStatus',
  {
    args: { identity: Schema.String, revision: Schema.Number },
    success: SpotifyStatus,
    error: Schema.String,
    staleTime: '30 seconds',
  },
) {
  static readonly layer = this.toLayer(
    Effect.map(
      SpotifyConnection,
      (connection) => () => connection.status.pipe(Effect.mapError((error) => error.message)),
    ),
  )
}

export class PerformSpotify extends Command.Service<PerformSpotify>()('spotify/PerformSpotify', {
  args: {
    action: Schema.Literals([
      'connect',
      'play',
      'queue',
      'save',
      'disconnect',
      'callback',
      'synchronize',
    ]),
    url: Schema.String,
    requestId: Schema.Number,
    identity: Schema.String,
    revision: Schema.Number,
    status: Schema.optional(SpotifyStatus),
  },
  success: SpotifyProviderMessage.cases.CompletedOperation,
  invalidates: (args) =>
    ['connect', 'disconnect', 'callback', 'synchronize'].includes(args.action)
      ? [ReadSpotifyStatus.entry({ identity: args.identity, revision: args.revision })]
      : [],
  writes: (result, args) =>
    result.status === null
      ? []
      : [
          ReadSpotifyStatus.set(
            { identity: args.identity, revision: args.revision },
            result.status,
          ),
        ],
}) {
  static readonly layer = this.toLayer(
    Effect.map(
      SpotifyConnection,
      (connection) =>
        ({ action, url, requestId, identity, revision, status }) => {
          const operation: Effect.Effect<
            {
              readonly notice: string
              readonly status: typeof SpotifyStatus.Type | null
            },
            SpotifyConnectionError
          > = (() => {
            switch (action) {
              case 'connect':
                return connection.connect.pipe(
                  Effect.andThen(connection.status),
                  Effect.map((status) => ({ notice: '', status })),
                )
              case 'disconnect':
                return connection.disconnect.pipe(
                  Effect.map((status) => ({ notice: 'Disconnected from Spotify.', status })),
                )
              case 'callback':
                return connection.completeCallback.pipe(
                  Effect.andThen(connection.status),
                  Effect.map((status) => ({ notice: 'Redirecting…', status })),
                )
              case 'synchronize':
                return status
                  ? Effect.succeed({ notice: '', status })
                  : Effect.fail(
                      new SpotifyConnectionError({
                        message: 'Spotify connection status is missing.',
                      }),
                    )
              default:
                return connection
                  .playback({ action, url })
                  .pipe(Effect.map((notice) => ({ notice, status: null })))
            }
          })()

          return operation.pipe(
            Effect.match({
              onSuccess: ({ notice, status }) =>
                SpotifyProviderMessage.CompletedOperation({
                  requestId,
                  identity,
                  revision,
                  notice,
                  status,
                }),
              onFailure: (error) =>
                SpotifyProviderMessage.CompletedOperation({
                  requestId,
                  identity,
                  revision,
                  status: null,
                  notice: error.message,
                  recovery: error.recovery,
                }),
            }),
          )
        },
    ),
  )
}

export const StartSpotifyClient = Command.make(
  'StartSpotifyClient',
  { args: { identity: Schema.String, revision: Schema.Number } },
  (args) =>
    ReadSpotifyStatus.invalidate(args).pipe(Effect.as(SpotifyProviderMessage.StartedClient())),
)

export const spotifyCommandsLayer = Layer.mergeAll(
  ReadSpotifyStatus.layer,
  PerformSpotify.layer,
).pipe(Layer.provide(SpotifyConnectionLive))
