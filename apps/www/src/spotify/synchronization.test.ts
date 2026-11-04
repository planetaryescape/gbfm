import { Deferred, Effect, Fiber } from 'effect'
import { describe, expect, it } from 'vitest'

import { init } from '../init'
import { Message } from '../message'
import type { Flags } from '../model'
import { SpotifyRequest } from '../page/dashboard/command'
import { Message as DashboardMessage } from '../page/dashboard/message'
import { update } from '../update'
import { disconnected, SpotifyConnection, SpotifyConnectionError } from './connection'
import * as Playback from './playback'

const flags: Flags = {
  url: 'https://fixture.test/dashboard/integrations',
  status: 200,
  principal: { id: 'fixture', role: 'user', name: 'Fixture', username: 'fixture' },
  items: [],
  title: 'Integrations',
  description: '',
  requestId: 'fixture',
  renderedAt: 0,
  skipSeen: false,
  tweet: null,
  neighbours: null,
  dashboard: null,
  profile: null,
  shows: null,
  changelog: null,
  publicAction: null,
  metadata: null,
  failure: null,
}

describe('Spotify application synchronization', () => {
  it.each(['success', 'failure'] as const)(
    'fences a real delayed dashboard %s and initial playback load after disconnect',
    async (outcome) => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const gate = yield* Deferred.make<typeof disconnected, SpotifyConnectionError>()

          const service = SpotifyConnection.of({
            status: Deferred.await(gate),
            connect: Effect.void,
            completeCallback: Effect.void,
            disconnect: Effect.succeed(disconnected),
            playback: () => Effect.succeed('unused'),
          })

          const oldStatus = yield* SpotifyRequest({ action: 'status', requestId: 1 }).effect.pipe(
            Effect.provideService(SpotifyConnection, service),
            Effect.forkChild,
          )

          const oldPlayback = yield* Playback.Load({ requestId: 0 }).effect.pipe(
            Effect.provideService(SpotifyConnection, service),
            Effect.forkChild,
          )

          const initial = init(flags).model

          const disconnect = update(
            initial,
            Message.GotDashboardMessage({
              message: DashboardMessage.SpotifyRequested({ action: 'disconnect' }),
            }),
          ).model

          const result = yield* SpotifyRequest({ action: 'disconnect', requestId: 2 }).effect.pipe(
            Effect.provideService(SpotifyConnection, service),
          )

          const completed = update(
            disconnect,
            Message.GotDashboardMessage({ message: result }),
          ).model

          expect(completed.spotifyPlayback.status).toEqual(disconnected)

          if (outcome === 'success')
            yield* Deferred.succeed(gate, { connected: true, name: 'Old account' })
          else yield* Deferred.fail(gate, new SpotifyConnectionError({ message: 'Old failure' }))

          const late = update(
            completed,
            Message.GotDashboardMessage({ message: yield* Fiber.join(oldStatus) }),
          ).model

          const final = update(
            late,
            Message.GotSpotifyPlaybackMessage({ message: yield* Fiber.join(oldPlayback) }),
          ).model

          expect(final.dashboard).toBe(completed.dashboard)
          expect(final.dashboard.error).toBeNull()
          expect(final.spotifyPlayback.status).toEqual(disconnected)
        }).pipe(Effect.scoped),
      )
    },
  )

  it('propagates the actual connected callback status into retained playback state', async () => {
    const connected = { connected: true, name: 'New account' }

    const service = SpotifyConnection.of({
      status: Effect.succeed(connected),
      connect: Effect.void,
      completeCallback: Effect.void,
      disconnect: Effect.succeed(disconnected),
      playback: () => Effect.succeed('unused'),
    })

    const initial = init({ ...flags, url: 'https://fixture.test/spotify/callback' }).model

    const message = await Effect.runPromise(
      SpotifyRequest({ action: 'completeCallback', requestId: 1 }).effect.pipe(
        Effect.provideService(SpotifyConnection, service),
      ),
    )

    const completed = update(initial, Message.GotDashboardMessage({ message })).model
    expect(completed.dashboard.spotify).toEqual(connected)
    expect(completed.spotifyPlayback.status).toEqual(connected)
  })
})
