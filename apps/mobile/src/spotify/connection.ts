import { useAtomMount, useAtomSet, useAtomValue } from '@effect/atom-react'
import {
  fetchSpotifyProfileEffect,
  getValidSpotifyAuthSessionEffect,
  logoutSpotifyEffect,
  spotifyErrorMessage,
  type SpotifyRequestError,
} from '@gbfm/spotify'
import { Effect } from 'effect'
import * as Atom from 'effect/reactivity/Atom'
import * as WebBrowser from 'expo-web-browser'
import { type PropsWithChildren, useCallback, useMemo } from 'react'

import { env } from '@/env'

import { connectSpotify } from './connectionLogin'
import { SpotifyConnectionState, type SetConnectionState } from './connectionState'
import { SPOTIFY_REDIRECT_URI } from './constants'
import { runSpotifyEffect } from './runtime'

export { SpotifyConnectionState } from './connectionState'

export const spotifyConnectionState = Atom.make<SpotifyConnectionState>(
  SpotifyConnectionState.Bootstrapping(),
).pipe(Atom.keepAlive)

const loadProfile = (setState: SetConnectionState) =>
  runSpotifyEffect(
    fetchSpotifyProfileEffect().pipe(
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
    ),
  )

const readStoredSession = async (setState: SetConnectionState) => {
  const stored = await runSpotifyEffect(
    getValidSpotifyAuthSessionEffect().pipe(
      Effect.catch((error: SpotifyRequestError) =>
        Effect.sync(() => {
          setState(() => SpotifyConnectionState.Disconnected({ error: spotifyErrorMessage(error) }))

          return undefined
        }),
      ),
    ),
  )

  setState(() =>
    stored
      ? SpotifyConnectionState.Connected({ session: stored })
      : SpotifyConnectionState.Disconnected({}),
  )

  if (stored) await loadProfile(setState)

  return stored
}

const makeBootstrapAtom = (setState: SetConnectionState) =>
  Atom.make(
    Effect.promise(() =>
      readStoredSession(setState).finally(() =>
        setState((state) =>
          SpotifyConnectionState.$is('Bootstrapping')(state)
            ? SpotifyConnectionState.Disconnected({})
            : state,
        ),
      ),
    ),
  )

export const useSpotifyConnection = <T>(selector: (state: SpotifyConnectionState) => T) =>
  useAtomValue(spotifyConnectionState, selector)

const useSetSpotifyConnectionState = (): SetConnectionState => useAtomSet(spotifyConnectionState)

export const SpotifyConnectionProvider = ({ children }: PropsWithChildren) => {
  const setState = useSetSpotifyConnectionState()
  const bootstrapAtom = useMemo(() => makeBootstrapAtom(setState), [setState])
  useAtomMount(bootstrapAtom)

  return children
}

export const useConnectSpotify = () => {
  const setState = useSetSpotifyConnectionState()

  return useCallback(
    () =>
      connectSpotify({
        clientId: env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID,
        redirectUri: SPOTIFY_REDIRECT_URI,
        setState,
        run: runSpotifyEffect,
        openLogin: WebBrowser.openAuthSessionAsync,
      }),
    [setState],
  )
}

export const useDisconnectSpotify = () => {
  const setState = useSetSpotifyConnectionState()

  return useCallback(() => {
    void runSpotifyEffect(logoutSpotifyEffect())
    setState(() => SpotifyConnectionState.Disconnected({}))
  }, [setState])
}
