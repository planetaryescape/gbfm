import { spotifyEntityFromUrl } from '@gbfm/spotify'
import {
  SpotifyConfigurationError,
  SpotifyHttpError,
  type Device,
  type PlayOptions,
  type SimplifiedTrack,
} from '@spotify-effect/core'
import { Deferred, Effect } from 'effect'
import { expect, test } from 'vitest'

import { SPOTIFY_NOTICES, spotifyEntityOperation } from './entityOperation'
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

test.each([
  ['play', SPOTIFY_NOTICES.opening, 1],
  ['queue', SPOTIFY_NOTICES.nothingPlaying, 0],
] as const)('%s without any Spotify device', async (action, expected, expectedOpens) => {
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
    expect(notices).toEqual([expected])
    expect(opened).toBe(expectedOpens)
  } finally {
    await f.dispose()
  }
})

test('provider errors are reported without leaving the app', async () => {
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
    expect(opened).toBe(0)
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

test('partial album queue failure keeps prior additions and reports the provider error', async () => {
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
    expect(opened).toBe(0)
  } finally {
    await f.dispose()
  }
})

test('save goes to the library without needing an active device', async () => {
  const notices: Array<string> = []
  const saved: Array<ReadonlyArray<string>> = []
  let opened = 0

  const f = await spotifyFixture((service) => ({
    ...service,
    player: { ...service.player, getMyDevices: () => Effect.succeed([]) },
    library: {
      ...service.library,
      saveTracks: (ids) =>
        Effect.sync(() => {
          saved.push(ids)
        }),
    },
  }))

  try {
    await f.run(
      spotifyEntityOperation(
        entity,
        'save',
        (message) => notices.push(message),
        () => {
          opened += 1
        },
      ),
    )
    expect(saved).toEqual([['fixture']])
    expect(notices).toEqual(['Saved to your library'])
    expect(opened).toBe(0)
  } finally {
    await f.dispose()
  }
})

const idle: Device = {
  ...device,
  id: 'phone',
  is_active: false,
  name: 'iPhone',
  type: 'Smartphone',
}

test('play targets an idle device instead of leaving the app', async () => {
  const notices: Array<string> = []
  const played: Array<PlayOptions | undefined> = []
  let opened = 0

  const f = await spotifyFixture((service) => ({
    ...service,
    player: {
      ...service.player,
      getMyDevices: () => Effect.succeed([idle]),
      play: (options) =>
        Effect.sync(() => {
          played.push(options)
        }),
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
    expect(played).toEqual([{ device_id: 'phone', uris: ['spotify:track:fixture'] }])
    expect(notices).toEqual(['Playing track on iPhone'])
    expect(opened).toBe(0)
  } finally {
    await f.dispose()
  }
})

test('queue asks for playback first when nothing is active', async () => {
  const notices: Array<string> = []
  let queued = 0

  const f = await spotifyFixture((service) => ({
    ...service,
    player: {
      ...service.player,
      getMyDevices: () => Effect.succeed([idle]),
      addToQueue: () =>
        Effect.sync(() => {
          queued += 1
        }),
    },
  }))

  try {
    await f.run(
      spotifyEntityOperation(
        entity,
        'queue',
        (message) => notices.push(message),
        () => {},
      ),
    )
    expect(queued).toBe(0)
    expect(notices).toEqual([SPOTIFY_NOTICES.nothingPlaying])
  } finally {
    await f.dispose()
  }
})

test('play explains that Premium is required when Spotify refuses control', async () => {
  const notices: Array<string> = []
  let opened = 0

  const f = await spotifyFixture((service) => ({
    ...service,
    player: {
      ...service.player,
      getMyDevices: () => Effect.succeed([device]),
      play: () =>
        Effect.fail(
          new SpotifyHttpError({
            status: 403,
            method: 'PUT',
            url: 'https://api.spotify.com/v1/me/player/play',
          }),
        ),
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
    expect(notices).toEqual([SPOTIFY_NOTICES.premium])
    expect(opened).toBe(0)
  } finally {
    await f.dispose()
  }
})
