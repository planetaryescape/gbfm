import { useAtomMount, useAtomSet, useAtomValue } from '@effect/atom-react'
import { Effect } from 'effect'
import * as Atom from 'effect/reactivity/Atom'
import * as WebBrowser from 'expo-web-browser'
import { type PropsWithChildren, useCallback, useMemo } from 'react'

import { env } from '@/env'

import { connectSpotify, restoreSpotifyConnection } from './connectionLogin'
import { SpotifyConnectionState, type SetConnectionState } from './connectionState'
import { SPOTIFY_REDIRECT_URI } from './constants'
import { spotifyLifecycle } from './runtime'

export { SpotifyConnectionState } from './connectionState'

export const spotifyConnectionState = Atom.make<SpotifyConnectionState>(
  SpotifyConnectionState.Bootstrapping(),
).pipe(Atom.keepAlive)

const makeBootstrapAtom = (setState: SetConnectionState) => {
  const owner = spotifyLifecycle.current()

  return Atom.make(
    Effect.promise(() => restoreSpotifyConnection(spotifyLifecycle, owner, setState)),
  )
}

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
        lifecycle: spotifyLifecycle,
        openLogin: WebBrowser.openAuthSessionAsync,
      }),
    [setState],
  )
}

export const useDisconnectSpotify = () => {
  const setState = useSetSpotifyConnectionState()

  return useCallback(() => {
    const pending = spotifyLifecycle.disconnect()
    const owner = spotifyLifecycle.current()
    void pending.catch(() =>
      setState((current) =>
        spotifyLifecycle.owns(owner) && SpotifyConnectionState.$is('Disconnected')(current)
          ? SpotifyConnectionState.Disconnected({
              error: 'Spotify could not disconnect. Try again.',
            })
          : current,
      ),
    )
    setState(() => SpotifyConnectionState.Disconnected({}))
  }, [setState])
}
