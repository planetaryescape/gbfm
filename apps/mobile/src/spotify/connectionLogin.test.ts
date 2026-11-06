import type { SpotifyAuthSession } from '@gbfm/spotify'
import { SpotifyConfigurationError } from '@spotify-effect/core'
import { Deferred, Effect } from 'effect'
import { expect, test } from 'vitest'

import { spotifyConnectionLifecycle } from './connectionLifecycle'
import { connectSpotify } from './connectionLogin'
import { SpotifyConnectionState, type SetConnectionState } from './connectionState'
import { SPOTIFY_CONFIGURATION_MESSAGE } from './constants'
import { spotifyFixture } from './operationFixture'

const session: SpotifyAuthSession = {
  accessToken: 'fixture',
  refreshToken: 'fixture',
  accessTokenExpiresAt: 9000000000000,
}

const connection = () => {
  let state: SpotifyConnectionState = SpotifyConnectionState.Disconnected({})

  const setState: SetConnectionState = (update) => {
    state = update(state)
  }

  return { setState, current: () => state }
}

test.each([undefined, '', '   '])(
  'missing client ID %j shows a useful error without opening login',
  async (clientId) => {
    const state = connection()
    const f = await spotifyFixture((service) => service)
    let opened = false

    try {
      await connectSpotify({
        clientId,
        redirectUri: 'gbfm://spotify/callback',
        setState: state.setState,
        lifecycle: spotifyConnectionLifecycle(f.run),
        openLogin: async () => {
          opened = true

          return { type: 'cancel' }
        },
      })

      expect(opened).toBe(false)
      expect(state.current()).toEqual(
        SpotifyConnectionState.Disconnected({ error: SPOTIFY_CONFIGURATION_MESSAGE }),
      )
    } finally {
      await f.dispose()
    }
  },
)

test.each(['cancel', 'dismiss', 'locked', 'opened'] as const)(
  '%s login returns to disconnected',
  async (type) => {
    const state = connection()

    const f = await spotifyFixture((service) => ({
      ...service,
      auth: { ...service.auth, startPkceLogin: () => Effect.succeed('https://fixture.test/login') },
    }))

    try {
      await connectSpotify({
        clientId: 'fixture',
        redirectUri: 'gbfm://spotify',
        setState: state.setState,
        lifecycle: spotifyConnectionLifecycle(f.run),
        openLogin: async () => ({ type }),
      })
      expect(state.current()).toEqual(SpotifyConnectionState.Disconnected({}))
    } finally {
      await f.dispose()
    }
  },
)

test('exchange failure exposes the provider error and leaves no connected session', async () => {
  const state = connection()

  const f = await spotifyFixture((service) => ({
    ...service,
    auth: {
      ...service.auth,
      startPkceLogin: () => Effect.succeed('https://fixture.test/login'),
      exchangeCode: () =>
        Effect.fail(new SpotifyConfigurationError({ message: 'exchange failed' })),
    },
  }))

  try {
    await connectSpotify({
      clientId: 'fixture',
      redirectUri: 'gbfm://spotify',
      setState: state.setState,
      lifecycle: spotifyConnectionLifecycle(f.run),
      openLogin: async () => ({ type: 'success', url: 'gbfm://spotify?code=fixture' }),
    })
    expect(state.current()).toEqual(
      SpotifyConnectionState.Disconnected({ error: 'exchange failed' }),
    )
  } finally {
    await f.dispose()
  }
})

test.each([
  {
    url: 'gbfm://spotify?error=access_denied',
    expected: SpotifyConnectionState.Disconnected({ error: 'access_denied' }),
  },
  { url: 'gbfm://spotify', expected: SpotifyConnectionState.Disconnected({}) },
])('callback $url retains its existing disconnected outcome', async ({ url, expected }) => {
  const state = connection()

  const f = await spotifyFixture((service) => ({
    ...service,
    auth: { ...service.auth, startPkceLogin: () => Effect.succeed('https://fixture.test/login') },
  }))

  try {
    await connectSpotify({
      clientId: 'fixture',
      redirectUri: 'gbfm://spotify',
      setState: state.setState,
      lifecycle: spotifyConnectionLifecycle(f.run),
      openLogin: async () => ({ type: 'success', url }),
    })
    expect(state.current()).toEqual(expected)
  } finally {
    await f.dispose()
  }
})

test('a late exchange after disconnect cannot restore Connected', async () => {
  const state = connection()
  const entered = Deferred.makeUnsafe<void>()
  const release = Deferred.makeUnsafe<void>()

  const f = await spotifyFixture((service) => ({
    ...service,
    auth: {
      ...service.auth,
      startPkceLogin: () => Effect.succeed('https://fixture.test/login'),
      exchangeCode: () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(entered, undefined)
          yield* Deferred.await(release)

          return session
        }),
    },
    users: {
      ...service.users,
      getCurrentUserProfile: () =>
        Effect.fail(new SpotifyConfigurationError({ message: 'profile failed' })),
    },
  }))

  try {
    const lifecycle = spotifyConnectionLifecycle(f.run)

    const pending = connectSpotify({
      clientId: 'fixture',
      redirectUri: 'gbfm://spotify',
      setState: state.setState,
      lifecycle,
      openLogin: async () => ({ type: 'success', url: 'gbfm://spotify?code=fixture' }),
    })

    await Effect.runPromise(Deferred.await(entered))
    state.setState(() => SpotifyConnectionState.Disconnected({}))
    const disconnect = lifecycle.disconnect()
    await Effect.runPromise(Deferred.succeed(release, undefined))
    await pending
    await disconnect
    expect(state.current()).toEqual(SpotifyConnectionState.Disconnected({}))
  } finally {
    await f.dispose()
  }
})
