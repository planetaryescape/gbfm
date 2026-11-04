import { spotifyEntityFromUrl } from '@gbfm/spotify'
import { SpotifyConfigurationError, type Device } from '@spotify-effect/core'
import { Deferred, Effect } from 'effect'
import { expect, test } from 'vitest'

import { spotifyConnectionLifecycle } from './connectionLifecycle'
import { spotifyEntityLifetime, runSpotifyEntityAction } from './entityLifetime'
import { spotifyFixture } from './operationFixture'

const entity = spotifyEntityFromUrl('spotify:track:fixture')

if (!entity) throw new Error('Expected fixture track')

const device: Device = {
  id: 'fixture',
  is_active: true,
  is_private_session: false,
  is_restricted: false,
  name: 'Fixture',
  type: 'Computer',
  volume_percent: 50,
}

test.each(['mounted', 'unmount', 'disconnect', 'replacement'] as const)(
  'entity admission is synchronous and completion is owned after %s',
  async (transition) => {
    const started = Deferred.makeUnsafe<void>()
    const release = Deferred.makeUnsafe<void>()
    const accepted: Array<string> = []
    const notices: Array<string> = []
    const pending: Array<'play' | 'queue' | null> = []
    let opened = 0

    const f = await spotifyFixture((service) => ({
      ...service,
      player: {
        ...service.player,
        getMyDevices: () => Effect.succeed([device]),
        play: () =>
          Effect.sync(() => {
            accepted.push('play')
          }).pipe(
            Effect.andThen(Deferred.succeed(started, undefined)),
            Effect.andThen(Deferred.await(release)),
          ),
        addToQueue: () =>
          Effect.sync(() => {
            accepted.push('queue')
          }),
      },
    }))

    const lifetime = spotifyEntityLifetime()
    const lifecycle = spotifyConnectionLifecycle(f.run)

    const input = {
      lifetime,
      lifecycle,
      generation: lifecycle.current(),
      entity,
      setPending: (action: 'play' | 'queue' | null) => {
        pending.push(action)
      },
      notice: (message: string) => {
        notices.push(message)
      },
      open: () => {
        opened += 1
      },
    }

    try {
      const first = runSpotifyEntityAction({ ...input, action: 'play' })
      await runSpotifyEntityAction({ ...input, action: 'queue' })
      await Effect.runPromise(Deferred.await(started))
      expect(accepted).toEqual(['play'])
      expect(pending).toEqual(['play'])
      let disconnect: Promise<void> | undefined
      let replacement: Promise<void> | undefined

      if (transition === 'unmount') lifetime.dispose()

      if (transition === 'disconnect') {
        disconnect = lifecycle.disconnect()
        await runSpotifyEntityAction({ ...input, action: 'queue' })
      }

      if (transition === 'replacement') {
        lifetime.dispose()
        lifetime.activate()
        replacement = runSpotifyEntityAction({ ...input, action: 'queue' })
      }

      await Effect.runPromise(Deferred.succeed(release, undefined))
      await Promise.all([first, disconnect, replacement])
      expect(opened).toBe(0)

      const expected = {
        mounted: { accepted: ['play'], notices: ['Playing track'], pending: ['play', null] },
        replacement: {
          accepted: ['play', 'queue'],
          notices: ['Added to queue'],
          pending: ['play', 'queue', null],
        },
        unmount: { accepted: ['play'], notices: [], pending: ['play'] },
        disconnect: { accepted: ['play'], notices: [], pending: ['play'] },
      }[transition]

      expect(accepted).toEqual(expected.accepted)
      expect(notices).toEqual(expected.notices)
      expect(pending).toEqual(expected.pending)
    } finally {
      await f.dispose()
    }
  },
)

test.each(['unmount', 'disconnect'] as const)(
  'a late device failure cannot notify or open fallback after %s',
  async (transition) => {
    const started = Deferred.makeUnsafe<void>()
    const release = Deferred.makeUnsafe<void>()
    const notices: Array<string> = []
    let opened = 0

    const f = await spotifyFixture((service) => ({
      ...service,
      player: {
        ...service.player,
        getMyDevices: () =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.andThen(Effect.fail(new SpotifyConfigurationError({ message: 'late failure' }))),
          ),
      },
    }))

    const lifecycle = spotifyConnectionLifecycle(f.run)
    const lifetime = spotifyEntityLifetime()

    try {
      const pending = runSpotifyEntityAction({
        lifetime,
        lifecycle,
        generation: lifecycle.current(),
        entity,
        action: 'play',
        setPending: () => {},
        notice: (message) => {
          notices.push(message)
        },
        open: () => {
          opened += 1
        },
      })

      await Effect.runPromise(Deferred.await(started))

      if (transition === 'unmount') lifetime.dispose()
      const disconnect = transition === 'disconnect' ? lifecycle.disconnect() : undefined
      await Effect.runPromise(Deferred.succeed(release, undefined))
      await Promise.all([pending, disconnect])
      expect(notices).toEqual([])
      expect(opened).toBe(0)
    } finally {
      await f.dispose()
    }
  },
)
