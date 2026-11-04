import type { SpotifyAuthSession, SpotifyProfile } from '@gbfm/spotify'
import { SpotifyConfigurationError } from '@spotify-effect/core'
import { Deferred, Effect } from 'effect'
import { expect, test } from 'vitest'

import { spotifyConnectionLifecycle } from './connectionLifecycle'
import { connectSpotify, restoreSpotifyConnection } from './connectionLogin'
import { SpotifyConnectionState, type SetConnectionState } from './connectionState'
import { spotifyFixture } from './operationFixture'
import { spotifyTokenStorage } from './tokenStorage'

const session: SpotifyAuthSession = {
  accessToken: 'fixture',
  refreshToken: 'fixture',
  accessTokenExpiresAt: 9000000000000,
}

const profile: SpotifyProfile = {
  display_name: 'Old profile',
  external_urls: { spotify: 'https://fixture.test/old' },
  followers: { href: null, total: 0 },
  href: 'https://fixture.test/old',
  id: 'old',
  images: [],
  type: 'user',
  uri: 'spotify:user:old',
}

const stateFixture = () => {
  let state: SpotifyConnectionState = SpotifyConnectionState.Bootstrapping()

  const setState: SetConnectionState = (update) => {
    state = update(state)
  }

  return { setState, current: () => state }
}

const persistedFixture = () => {
  let persisted: string | null = null

  const tokens = spotifyTokenStorage({
    read: async () => persisted,
    write: async (value) => {
      persisted = value
    },
    remove: async () => {
      persisted = null
    },
  })

  return { tokens, persisted: () => persisted }
}

test.each(['exchange', 'refresh'] as const)(
  'disconnect fences a real SDK token write from a pending %s',
  async (operation) => {
    const state = stateFixture()
    const storage = persistedFixture()
    const started = Deferred.makeUnsafe<void>()
    const release = Deferred.makeUnsafe<void>()

    const f = await spotifyFixture((service) => {
      const lateSession = Effect.gen(function* () {
        yield* Deferred.succeed(started, undefined)
        yield* Deferred.await(release)
        service.auth.setTokens(session)

        return session
      })

      if (operation === 'refresh') service.auth.setTokens({ ...session, accessTokenExpiresAt: 1 })

      return {
        ...service,
        auth: {
          ...service.auth,
          startPkceLogin: () => Effect.succeed('https://fixture.test/login'),
          exchangeCode: () => lateSession,
          refreshToken: () => lateSession,
        },
        users: {
          ...service.users,
          getCurrentUserProfile: () =>
            Effect.fail(new SpotifyConfigurationError({ message: 'fixture profile unavailable' })),
        },
      }
    }, storage.tokens.storage)

    const lifecycle = spotifyConnectionLifecycle(async (work, options) => {
      storage.tokens.guardWrites(options?.isCurrent ?? (() => true))

      return f.run(work)
    }, storage.tokens.invalidate)

    try {
      const pending =
        operation === 'exchange'
          ? connectSpotify({
              clientId: 'fixture',
              redirectUri: 'gbfm://spotify',
              setState: state.setState,
              lifecycle,
              openLogin: async () => ({ type: 'success', url: 'gbfm://spotify?code=fixture' }),
            })
          : restoreSpotifyConnection(lifecycle, lifecycle.current(), state.setState)

      await Effect.runPromise(Deferred.await(started))
      const disconnect = lifecycle.disconnect()
      state.setState(() => SpotifyConnectionState.Disconnected({}))
      await Effect.runPromise(Deferred.succeed(release, undefined))
      await Promise.all([pending, disconnect])
      await storage.tokens.settled()
      expect(state.current()).toEqual(SpotifyConnectionState.Disconnected({}))
      expect(f.tokens()).toBeUndefined()
      expect(storage.tokens.storage.getItem('spotify-effect:tokens')).toBeNull()
      expect(storage.persisted()).toBeNull()
    } finally {
      await f.dispose()
    }
  },
)

test.each(['success', 'failure'] as const)(
  'an old bootstrap profile %s and finalizer cannot alter a newer login or its stored tokens',
  async (outcome) => {
    const state = stateFixture()
    const storage = persistedFixture()
    const started = Deferred.makeUnsafe<void>()
    const release = Deferred.makeUnsafe<void>()
    let profiles = 0
    const nextSession = { ...session, accessToken: 'new fixture' }

    const f = await spotifyFixture((service) => {
      service.auth.setTokens(session)

      return {
        ...service,
        auth: {
          ...service.auth,
          startPkceLogin: () => Effect.succeed('https://fixture.test/login'),
          exchangeCode: () =>
            Effect.sync(() => {
              service.auth.setTokens(nextSession)

              return nextSession
            }),
        },
        users: {
          ...service.users,
          getCurrentUserProfile: () =>
            Effect.suspend(() => {
              profiles += 1

              return profiles === 1
                ? Deferred.succeed(started, undefined).pipe(
                    Effect.andThen(Deferred.await(release)),
                    Effect.andThen(
                      outcome === 'success'
                        ? Effect.succeed(profile)
                        : Effect.fail(new SpotifyConfigurationError({ message: 'old profile' })),
                    ),
                  )
                : Effect.fail(new SpotifyConfigurationError({ message: 'new profile' }))
            }),
        },
      }
    }, storage.tokens.storage)

    const lifecycle = spotifyConnectionLifecycle(async (work, options) => {
      storage.tokens.guardWrites(options?.isCurrent ?? (() => true))

      return f.run(work)
    }, storage.tokens.invalidate)

    try {
      const restore = restoreSpotifyConnection(lifecycle, lifecycle.current(), state.setState)
      await Effect.runPromise(Deferred.await(started))

      const login = connectSpotify({
        clientId: 'fixture',
        redirectUri: 'gbfm://spotify',
        setState: state.setState,
        lifecycle,
        openLogin: async () => ({ type: 'success', url: 'gbfm://spotify?code=fixture' }),
      })

      expect(state.current()).toEqual(SpotifyConnectionState.Connecting())
      await Effect.runPromise(Deferred.succeed(release, undefined))
      await Promise.all([restore, login])
      await storage.tokens.settled()
      expect(state.current()).toEqual(
        SpotifyConnectionState.Connected({ session: nextSession, error: 'new profile' }),
      )
      expect(f.tokens()).toEqual(nextSession)
      expect(storage.persisted()).toContain('new fixture')
    } finally {
      await f.dispose()
    }
  },
)

test('same-render login admission starts one browser and releases ownership on cancellation', async () => {
  const state = stateFixture()
  const browser = Promise.withResolvers<{ readonly type: 'cancel' }>()
  const opened = Promise.withResolvers<void>()
  let starts = 0

  const f = await spotifyFixture((service) => ({
    ...service,
    auth: { ...service.auth, startPkceLogin: () => Effect.succeed('https://fixture.test/login') },
  }))

  const lifecycle = spotifyConnectionLifecycle(f.run)

  const input = {
    clientId: 'fixture',
    redirectUri: 'gbfm://spotify',
    setState: state.setState,
    lifecycle,
    openLogin: async () => {
      starts += 1
      opened.resolve()

      return browser.promise
    },
  }

  try {
    const first = connectSpotify(input)
    const second = connectSpotify(input)
    await opened.promise
    expect(starts).toBe(1)
    browser.resolve({ type: 'cancel' })
    await Promise.all([first, second])
    expect(state.current()).toEqual(SpotifyConnectionState.Disconnected({}))
    expect(lifecycle.beginLogin()).not.toBeNull()
  } finally {
    await f.dispose()
  }
})
