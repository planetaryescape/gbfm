import { Context, Data, Effect, Layer, Schema } from 'effect'

export const SpotifyStatus = Schema.Struct({
  connected: Schema.Boolean,
  name: Schema.String,
})

export const disconnected = { connected: false, name: '' }

export class SpotifyConnectionError extends Data.TaggedError('SpotifyConnectionError')<{
  readonly message: string
}> {}

export class SpotifyConnection extends Context.Service<
  SpotifyConnection,
  {
    readonly status: Effect.Effect<typeof SpotifyStatus.Type, SpotifyConnectionError>
    readonly playback: (input: {
      readonly url: string
      readonly action: 'play' | 'queue' | 'save'
    }) => Effect.Effect<string, SpotifyConnectionError>
    readonly connect: Effect.Effect<void, SpotifyConnectionError>
    readonly disconnect: Effect.Effect<typeof SpotifyStatus.Type, SpotifyConnectionError>
    readonly completeCallback: Effect.Effect<void, SpotifyConnectionError>
  }
>()('@gbfm/www/SpotifyConnection') {}

// Neither download nor acquire the optional SDK until a Spotify operation runs.
const withConnection = <A>(
  operation: (connection: SpotifyConnection['Service']) => Effect.Effect<A, SpotifyConnectionError>,
) =>
  Effect.tryPromise({
    try: () => import('./runtime'),
    catch: () =>
      new SpotifyConnectionError({
        message: 'Spotify could not load. Check your connection and try again.',
      }),
  }).pipe(
    Effect.flatMap(({ browserConnectionLayer }) =>
      SpotifyConnection.pipe(
        Effect.flatMap(operation),
        // oxlint-disable-next-line effecttsgo/strict-effect-provide -- This browser adapter owns the third-party SDK's acquisition boundary.
        Effect.provide(browserConnectionLayer),
      ),
    ),
    Effect.catchDefect(() =>
      Effect.fail(
        new SpotifyConnectionError({
          message: 'Spotify is unavailable. Check site storage and try again.',
        }),
      ),
    ),
  )

export const SpotifyConnectionLive = Layer.succeed(SpotifyConnection, {
  status: withConnection((connection) => connection.status),
  playback: (input) => withConnection((connection) => connection.playback(input)),
  connect: withConnection((connection) => connection.connect),
  disconnect: withConnection((connection) => connection.disconnect),
  completeCallback: withConnection((connection) => connection.completeCallback),
})
