import {
  exchangeSpotifyPkceCodeEffect,
  fetchSpotifyProfileEffect,
  getValidSpotifyAuthSessionEffect,
  readAuthorizationCallback,
  SPOTIFY_WEB_SCOPES,
  spotifyErrorMessage,
  startSpotifyPkceLoginEffect,
  type SpotifyRequestError,
} from '@gbfm/spotify'
import { Effect } from 'effect'

import type { SpotifyConnectionLifecycle } from './connectionLifecycle'
import { SpotifyConnectionState, type SetConnectionState } from './connectionState'

const exchangeAndPersist = (code: string, setState: SetConnectionState) =>
  Effect.gen(function* () {
    const session = yield* exchangeSpotifyPkceCodeEffect(code)
    setState(() => SpotifyConnectionState.Connected({ session }))
    yield* fetchSpotifyProfileEffect().pipe(
      Effect.map((profile) =>
        setState((state) =>
          SpotifyConnectionState.$is('Connected')(state) && state.session === session
            ? SpotifyConnectionState.Connected({ session: state.session, profile })
            : state,
        ),
      ),
      Effect.catch((error: SpotifyRequestError) =>
        Effect.sync(() =>
          setState((state) =>
            SpotifyConnectionState.$is('Connected')(state) && state.session === session
              ? SpotifyConnectionState.Connected({ ...state, error: spotifyErrorMessage(error) })
              : state,
          ),
        ),
      ),
    )
  }).pipe(
    Effect.catch((error: SpotifyRequestError) =>
      Effect.sync(() =>
        setState(() => SpotifyConnectionState.Disconnected({ error: spotifyErrorMessage(error) })),
      ),
    ),
  )

export const connectSpotify = async (input: {
  readonly clientId: string | undefined
  readonly redirectUri: string
  readonly setState: SetConnectionState
  readonly lifecycle: SpotifyConnectionLifecycle
  readonly openLogin: (
    url: string,
    redirectUri: string,
  ) => Promise<
    | { readonly type: 'success'; readonly url: string }
    | { readonly type: 'cancel' | 'dismiss' | 'locked' | 'opened' }
  >
}) => {
  const { lifecycle } = input
  const owner = lifecycle.beginLogin()

  if (owner === null) return

  const setState: SetConnectionState = (update) =>
    input.setState((current) => (lifecycle.owns(owner) ? update(current) : current))

  if (!input.clientId) {
    setState(() =>
      SpotifyConnectionState.Disconnected({ error: 'Missing EXPO_PUBLIC_SPOTIFY_CLIENT_ID.' }),
    )
    lifecycle.finishLogin(owner)

    return
  }

  setState(() => SpotifyConnectionState.Connecting())

  try {
    const authUrl = await lifecycle.run(
      owner,
      startSpotifyPkceLoginEffect(SPOTIFY_WEB_SCOPES, input.redirectUri),
    )

    if (!authUrl || !lifecycle.owns(owner)) return

    const result = await input.openLogin(authUrl, input.redirectUri)

    if (!lifecycle.owns(owner)) return

    if (result.type !== 'success') return

    const callback = readAuthorizationCallback(new URL(result.url))

    if (callback.error) {
      setState(() =>
        SpotifyConnectionState.Disconnected({ error: callback.error ?? 'Spotify login failed.' }),
      )

      return
    }

    if (!callback.code) return

    await lifecycle.run(owner, exchangeAndPersist(callback.code, setState))
  } catch {
    setState(() =>
      SpotifyConnectionState.Disconnected({ error: 'Spotify could not connect. Try again.' }),
    )
  } finally {
    lifecycle.finishLogin(owner)
    setState((state) =>
      SpotifyConnectionState.$is('Connecting')(state)
        ? SpotifyConnectionState.Disconnected({})
        : state,
    )
  }
}

export const restoreSpotifyConnection = (
  lifecycle: SpotifyConnectionLifecycle,
  owner: number,
  setState: SetConnectionState,
) => {
  const setOwned: SetConnectionState = (update) =>
    setState((current) => (lifecycle.owns(owner) ? update(current) : current))

  return lifecycle
    .run(
      owner,
      Effect.gen(function* () {
        const session = yield* getValidSpotifyAuthSessionEffect()

        if (!session) {
          setOwned(() => SpotifyConnectionState.Disconnected({}))

          return
        }

        setOwned(() => SpotifyConnectionState.Connected({ session }))
        yield* fetchSpotifyProfileEffect().pipe(
          Effect.tap((profile) =>
            Effect.sync(() =>
              setOwned((current) =>
                SpotifyConnectionState.$is('Connected')(current) && current.session === session
                  ? SpotifyConnectionState.Connected({ session, profile })
                  : current,
              ),
            ),
          ),
          Effect.catch((error: SpotifyRequestError) =>
            Effect.sync(() =>
              setOwned((current) =>
                SpotifyConnectionState.$is('Connected')(current) && current.session === session
                  ? SpotifyConnectionState.Connected({
                      ...current,
                      error: spotifyErrorMessage(error),
                    })
                  : current,
              ),
            ),
          ),
        )
      }).pipe(
        Effect.catch((error: SpotifyRequestError) =>
          Effect.sync(() =>
            setOwned(() =>
              SpotifyConnectionState.Disconnected({ error: spotifyErrorMessage(error) }),
            ),
          ),
        ),
      ),
    )
    .catch(() => {
      setOwned(() =>
        SpotifyConnectionState.Disconnected({ error: 'Spotify is unavailable. Try again.' }),
      )
    })
}
