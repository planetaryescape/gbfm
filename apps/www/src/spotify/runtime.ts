import {
  exchangeSpotifyPkceCodeEffect,
  fetchSpotifyProfileEffect,
  getValidSpotifyAuthSessionEffect,
  isSpotifyForbidden,
  logoutSpotifyEffect,
  playSpotifyEntityEffect,
  queueSpotifyEntityEffect,
  readAuthorizationCallback,
  saveSpotifyEntityEffect,
  spotifyEntityFromUrl,
  spotifyErrorMessage,
  SpotifyBrowser,
  SPOTIFY_WEB_SCOPES,
  startSpotifyPkceLoginEffect,
} from '@gbfm/spotify'
import { Effect, Layer } from 'effect'

import { disconnected, SpotifyConnection, SpotifyConnectionError } from './connection'

const stateKey = 'gbfm:spotify-oauth-state'

const returnKey = 'gbfm:spotify-return-path'

const callbackPath = '/spotify/callback'

export const safeReturnPath = (path: string | null) => {
  if (!path || !path.startsWith('/') || path.startsWith('//') || path.includes('\\'))
    return '/dashboard/integrations'
  const url = new URL(path, 'https://gbfm.invalid')

  return url.origin === 'https://gbfm.invalid' && url.pathname !== callbackPath
    ? `${url.pathname}${url.search}${url.hash}`
    : '/dashboard/integrations'
}

/** Consume state before exchanging the code; failed and replayed callbacks cannot reuse it. */
export const consumeCallback = (url: URL, storage: Pick<Storage, 'getItem' | 'removeItem'>) => {
  const expected = storage.getItem(stateKey)
  const destination = safeReturnPath(storage.getItem(returnKey))
  storage.removeItem(stateKey)
  storage.removeItem(returnKey)
  const callback = readAuthorizationCallback(url)

  if (callback.error || !callback.code || !callback.state || callback.state !== expected)
    return null

  return { code: callback.code, destination }
}

const boundary = <A>(operation: () => A) =>
  Effect.try({
    try: operation,
    catch: () =>
      new SpotifyConnectionError({
        message: 'Browser storage is unavailable. Allow site storage and try again.',
      }),
  })

const connectionLayer = Layer.effect(
  SpotifyConnection,
  Effect.gen(function* () {
    const spotify = yield* SpotifyBrowser

    const status = getValidSpotifyAuthSessionEffect().pipe(
      Effect.flatMap((session) =>
        session
          ? fetchSpotifyProfileEffect().pipe(
              Effect.map((profile) => ({
                connected: true,
                name: profile.display_name ?? profile.id,
              })),
            )
          : Effect.succeed(disconnected),
      ),
      Effect.provideService(SpotifyBrowser, spotify),
      Effect.mapError(
        () =>
          new SpotifyConnectionError({
            message: 'Could not read Spotify session. Try connecting again.',
          }),
      ),
    )

    return {
      status,
      playback: ({ url, action }) =>
        Effect.gen(function* () {
          const entity = spotifyEntityFromUrl(url)

          if (!entity)
            return yield* Effect.fail(
              new SpotifyConnectionError({ message: 'Unsupported Spotify link.' }),
            )
          const session = yield* getValidSpotifyAuthSessionEffect()

          if (!session)
            return yield* Effect.fail(
              new SpotifyConnectionError({
                message: 'Connect Spotify to play, queue or save music.',
              }),
            )

          if (action === 'save') {
            const saved = yield* saveSpotifyEntityEffect(entity)

            return saved
              ? 'Saved to your Spotify library.'
              : 'Playlists cannot be saved to your library from here.'
          }

          const devices = yield* spotify.player.getMyDevices()

          if (!devices.some((device) => device.is_active && !device.is_restricted))
            return 'No active Spotify device. Open Spotify, start playback on a device, then try again.'

          if (action === 'play') {
            yield* playSpotifyEntityEffect(entity)

            return 'Playing on your active Spotify device.'
          }

          const count = yield* queueSpotifyEntityEffect(entity)

          return count === 0
            ? 'No playable tracks found.'
            : `Added ${count} ${count === 1 ? 'track' : 'tracks'} to your Spotify queue.`
        }).pipe(
          Effect.provideService(SpotifyBrowser, spotify),
          Effect.mapError((error) => {
            if (error instanceof SpotifyConnectionError) return error

            if (action === 'save' && isSpotifyForbidden(error))
              return new SpotifyConnectionError({
                message: 'Reconnect Spotify to allow saving to your library.',
              })

            return new SpotifyConnectionError({
              message:
                spotifyErrorMessage(error) === 'No active Spotify device'
                  ? 'No active Spotify device. Open Spotify, start playback on a device, then try again.'
                  : 'Spotify could not complete this action. Check your Premium account and device, then try again. Queue actions may have partially completed.',
            })
          }),
        ),
      connect: Effect.gen(function* () {
        const state = yield* boundary(() => crypto.randomUUID())

        const authorization = yield* startSpotifyPkceLoginEffect(
          SPOTIFY_WEB_SCOPES,
          `${location.origin}${callbackPath}`,
        )

        yield* boundary(() => {
          sessionStorage.setItem(stateKey, state)
          sessionStorage.setItem(returnKey, `${location.pathname}${location.search}`)
          const url = new URL(authorization)
          url.searchParams.set('state', state)
          location.assign(url.href)
        })
      }).pipe(
        Effect.provideService(SpotifyBrowser, spotify),
        Effect.mapError(
          () =>
            new SpotifyConnectionError({
              message: 'Could not start Spotify login. Check browser storage and try again.',
            }),
        ),
      ),
      disconnect: logoutSpotifyEffect().pipe(
        Effect.provideService(SpotifyBrowser, spotify),
        Effect.as(disconnected),
        Effect.mapError(
          () => new SpotifyConnectionError({ message: 'Could not disconnect Spotify.' }),
        ),
      ),
      completeCallback: Effect.gen(function* () {
        const callback = yield* boundary(() => {
          const url = new URL(location.href)
          history.replaceState(history.state, '', callbackPath)

          return consumeCallback(url, sessionStorage)
        })

        const validated = yield* callback
          ? Effect.succeed(callback)
          : Effect.fail(
              new SpotifyConnectionError({
                message:
                  'Spotify authorization is missing, expired, or invalid. Connect again from settings.',
              }),
            )

        yield* exchangeSpotifyPkceCodeEffect(validated.code).pipe(
          Effect.mapError(
            () =>
              new SpotifyConnectionError({
                message: 'Spotify could not complete authorization. Connect again from settings.',
              }),
          ),
        )
        yield* boundary(() => location.replace(validated.destination))
      }).pipe(Effect.provideService(SpotifyBrowser, spotify)),
    }
  }),
)

export const browserConnectionLayer = connectionLayer.pipe(
  Layer.provide(
    Layer.suspend(() =>
      SpotifyBrowser.layer({
        clientId: import.meta.env.VITE_SPOTIFY_CLIENT_ID ?? '',
        redirectUri: `${location.origin}${callbackPath}`,
        session: { sessionStorage, localStorage, history },
      }),
    ),
  ),
)
