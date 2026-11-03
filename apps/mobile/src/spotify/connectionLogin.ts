import {
  exchangeSpotifyPkceCodeEffect,
  fetchSpotifyProfileEffect,
  readAuthorizationCallback,
  SPOTIFY_WEB_SCOPES,
  spotifyErrorMessage,
  startSpotifyPkceLoginEffect,
  type SpotifyBrowser,
  type SpotifyRequestError,
} from '@gbfm/spotify'
import { Effect } from 'effect'

import { SpotifyConnectionState, type SetConnectionState } from './connectionState'

type SpotifyRunner = <A, E>(work: Effect.Effect<A, E, SpotifyBrowser>) => Promise<A>

const exchangeAndPersist = (code: string, setState: SetConnectionState) =>
  Effect.gen(function* () {
    const session = yield* exchangeSpotifyPkceCodeEffect(code)
    setState(() => SpotifyConnectionState.Connected({ session }))
    yield* fetchSpotifyProfileEffect().pipe(
      Effect.map((profile) =>
        setState((state) =>
          SpotifyConnectionState.$is('Connected')(state)
            ? SpotifyConnectionState.Connected({ session: state.session, profile })
            : state,
        ),
      ),
      Effect.catch((error: SpotifyRequestError) =>
        Effect.sync(() =>
          setState((state) =>
            SpotifyConnectionState.$is('Connected')(state)
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
  readonly run: SpotifyRunner
  readonly openLogin: (
    url: string,
    redirectUri: string,
  ) => Promise<
    | { readonly type: 'success'; readonly url: string }
    | { readonly type: 'cancel' | 'dismiss' | 'locked' | 'opened' }
  >
}) => {
  const { setState, run } = input

  if (!input.clientId) {
    setState(() =>
      SpotifyConnectionState.Disconnected({ error: 'Missing EXPO_PUBLIC_SPOTIFY_CLIENT_ID.' }),
    )

    return
  }

  setState(() => SpotifyConnectionState.Connecting())

  try {
    const authUrl = await run(startSpotifyPkceLoginEffect(SPOTIFY_WEB_SCOPES, input.redirectUri))

    if (!authUrl) return

    const result = await input.openLogin(authUrl, input.redirectUri)

    if (result.type !== 'success') return

    const callback = readAuthorizationCallback(new URL(result.url))

    if (callback.error) {
      setState(() =>
        SpotifyConnectionState.Disconnected({ error: callback.error ?? 'Spotify login failed.' }),
      )

      return
    }

    if (!callback.code) return

    await run(exchangeAndPersist(callback.code, setState))
  } finally {
    setState((state) =>
      SpotifyConnectionState.$is('Connecting')(state)
        ? SpotifyConnectionState.Disconnected({})
        : state,
    )
  }
}
