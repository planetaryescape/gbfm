import { spotifyEntityFromUrl } from '@gbfm/spotify'
import { SpotifyConfigurationError, type Device, type SimplifiedTrack } from '@spotify-effect/core'
import { Deferred, Effect } from 'effect'
import { expect, test } from 'vitest'

import { spotifyEntityOperation } from './entityOperation'
import { spotifyFixture } from './operationFixture'

const entity = spotifyEntityFromUrl('spotify:track:fixture')

if (!entity) throw new Error('expected a track')

const device: Device = {
  id: 'device',
  is_active: true,
  is_private_session: false,
  is_restricted: false,
  name: 'fixture',
  type: 'Computer',
  volume_percent: 50,
}

test.each(['play', 'queue'] as const)(
  '%s falls back when no device is available',
  async (action) => {
    const notices: Array<string> = []
    let opened = 0

    const f = await spotifyFixture((service) => ({
      ...service,
      player: { ...service.player, getMyDevices: () => Effect.succeed([]) },
    }))

    try {
      await f.run(
        spotifyEntityOperation(
          entity,
          action,
          (message) => notices.push(message),
          () => {
            opened += 1
          },
        ),
      )
      expect(notices).toEqual(['No active Spotify device, opening in Spotify instead'])
      expect(opened).toBe(1)
    } finally {
      await f.dispose()
    }
  },
)

test('provider errors retain fallback behavior', async () => {
  const notices: Array<string> = []
  let opened = 0

  const f = await spotifyFixture((service) => ({
    ...service,
    player: {
      ...service.player,
      getMyDevices: () =>
        Effect.fail(new SpotifyConfigurationError({ message: 'device check failed' })),
    },
  }))

  try {
    await f.run(
      spotifyEntityOperation(
        entity,
        'play',
        (message) => notices.push(message),
        () => {
          opened += 1
        },
      ),
    )
    expect(notices).toEqual(['device check failed'])
    expect(opened).toBe(1)
  } finally {
    await f.dispose()
  }
})

test('characterizes repeated operations: provider work is not coalesced or cancelled by the operation module', async () => {
  const entered = Deferred.makeUnsafe<void>()
  const release = Deferred.makeUnsafe<void>()
  const notices: Array<string> = []
  let attempts = 0

  const f = await spotifyFixture((service) => ({
    ...service,
    player: {
      ...service.player,
      getMyDevices: () =>
        Effect.gen(function* () {
          attempts += 1

          if (attempts === 2) yield* Deferred.succeed(entered, undefined)
          yield* Deferred.await(release)

          return [
            {
              id: 'device',
              is_active: true,
              is_private_session: false,
              is_restricted: false,
              name: 'fixture',
              type: 'Computer',
              volume_percent: 50,
              supports_volume: true,
            },
          ]
        }),
      play: () => Effect.void,
      addToQueue: () => Effect.void,
    },
  }))

  try {
    const play = f.run(
      spotifyEntityOperation(
        entity,
        'play',
        (message) => notices.push(message),
        () => {},
      ),
    )

    const queue = f.run(
      spotifyEntityOperation(
        entity,
        'queue',
        (message) => notices.push(message),
        () => {},
      ),
    )

    await Effect.runPromise(Deferred.await(entered))
    expect(attempts).toBe(2)
    await Effect.runPromise(Deferred.succeed(release, undefined))
    await Promise.all([play, queue])
    expect(notices.toSorted()).toEqual(['Added to queue', 'Playing track'])
  } finally {
    await f.dispose()
  }
})

test('partial album queue failure keeps prior additions and reports the provider error with fallback', async () => {
  const album = spotifyEntityFromUrl('spotify:album:fixture')

  if (!album) throw new Error('expected an album')

  const track = (id: string): SimplifiedTrack => ({
    id,
    uri: `spotify:track:${id}`,
    type: 'track',
    name: id,
    artists: [],
    available_markets: [],
    disc_number: 1,
    duration_ms: 1000,
    explicit: false,
    external_urls: { spotify: `https://open.spotify.com/track/${id}` },
    href: `https://api.spotify.com/v1/tracks/${id}`,
    preview_url: null,
    track_number: 1,
    is_local: false,
  })

  const added: Array<string> = []
  const notices: Array<string> = []
  let opened = 0

  const f = await spotifyFixture((service) => ({
    ...service,
    player: {
      ...service.player,
      getMyDevices: () => Effect.succeed([device]),
      addToQueue: (uri) =>
        uri === 'spotify:track:second'
          ? Effect.fail(new SpotifyConfigurationError({ message: 'queue failed' }))
          : Effect.sync(() => {
              added.push(uri)
            }),
    },
    albums: {
      ...service.albums,
      getAlbumTracks: () =>
        Effect.succeed({
          href: 'https://fixture.test/album',
          items: [track('first'), track('second'), track('third')],
          limit: 50,
          next: null,
          offset: 0,
          previous: null,
          total: 3,
        }),
    },
  }))

  try {
    await f.run(
      spotifyEntityOperation(
        album,
        'queue',
        (message) => notices.push(message),
        () => {
          opened += 1
        },
      ),
    )
    expect(added).toEqual(['spotify:track:first'])
    expect(notices).toEqual(['queue failed'])
    expect(opened).toBe(1)
  } finally {
    await f.dispose()
  }
})
