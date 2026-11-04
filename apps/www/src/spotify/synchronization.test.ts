import { MicroPostScreenResponse } from '@gbfm/api/post'
import { Deferred, Effect, Fiber, Option, Schema } from 'effect'
import { fromString } from 'foldkit/url'
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
  it('does not retain a pending Spotify request when anonymous init drops dashboard commands', () => {
    const anonymous = init({ ...flags, principal: null })
    expect(anonymous.model.dashboard.spotifyPending).toBeNull()

    const connect = update(
      anonymous.model,
      Message.GotDashboardMessage({
        message: DashboardMessage.SpotifyRequested({ action: 'connect' }),
      }),
    )

    expect(connect.commands?.some(({ name }) => name === 'Spotify.Connection')).toBe(true)
  })

  it('allocates a fresh status load from retained playback on actual tweet navigation', async () => {
    const post = {
      id: 'fixture-post',
      slug: 'fixture',
      title: null,
      description: null,
      thumbnailUrl: null,
      content: 'Fixture',
      draft: false,
      tags: [],
      type: 'micro',
      musicEntityType: null,
      musicEntityId: null,
      parentPostId: null,
      rootPostId: null,
      depth: 0,
      quotedPostId: null,
      createdAt: '2024-04-01T00:00:00Z',
      updatedAt: '2024-04-01T00:00:00Z',
      compiledContent: 'Fixture',
      music: null,
    }

    const tweetFlags: Flags = {
      ...flags,
      url: 'https://fixture.test/tweet/fixture',
      tweet: Schema.decodeUnknownSync(MicroPostScreenResponse)({
        post,
        root: post,
        replies: [],
        quote: null,
      }),
    }

    const initial = init(flags).model

    const connected = update(
      initial,
      Message.GotDashboardMessage({
        message: DashboardMessage.SpotifyLoaded({
          requestId: 1,
          status: { connected: true, name: 'Previous account' },
        }),
      }),
    ).model

    const oldId = connected.spotifyPlayback.statusRequestId
    const gate = Deferred.makeUnsafe<typeof disconnected>()

    const service = SpotifyConnection.of({
      status: Effect.succeed(disconnected),
      connect: Effect.void,
      completeCallback: Effect.void,
      disconnect: Effect.succeed(disconnected),
      playback: () => Effect.succeed('unused'),
    })

    const oldLoad = Effect.runPromise(
      Playback.Load({ requestId: oldId }).effect.pipe(
        Effect.provideService(SpotifyConnection, { ...service, status: Deferred.await(gate) }),
      ),
    )

    const navigating = update(
      connected,
      Message.ChangedUrl({ url: Option.getOrThrow(fromString(tweetFlags.url)) }),
    ).model

    const shown = update(
      navigating,
      Message.LoadedPage({
        flags: tweetFlags,
        key: '/tweet/fixture',
        navigationId: navigating.navigationId,
      }),
    )

    const freshId = shown.model.spotifyPlayback.statusRequestId
    expect(freshId).toBeGreaterThan(oldId)
    expect(shown.commands?.find(({ name }) => name === 'Spotify.PlaybackStatus')).toMatchObject({
      args: { requestId: freshId },
    })

    const result = await Effect.runPromise(
      Playback.Load({ requestId: freshId }).effect.pipe(
        Effect.provideService(SpotifyConnection, service),
      ),
    )

    const refreshed = update(
      shown.model,
      Message.GotSpotifyPlaybackMessage({ message: result }),
    ).model

    expect(refreshed.spotifyPlayback.status).toEqual(disconnected)
    await Effect.runPromise(Deferred.succeed(gate, { connected: true, name: 'Obsolete load' }))
    expect(
      update(refreshed, Message.GotSpotifyPlaybackMessage({ message: await oldLoad })).model
        .spotifyPlayback,
    ).toBe(refreshed.spotifyPlayback)
  })
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
