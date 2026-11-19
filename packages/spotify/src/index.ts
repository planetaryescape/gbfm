import {
  type BrowserRefreshableTokens,
  readAuthorizationCallback,
  SpotifyBrowser,
} from '@spotify-effect/browser'
import type { Device, PrivateUser, SpotifyRequestError } from '@spotify-effect/core'
import { SpotifyHttpError, SpotifyRateLimitError } from '@spotify-effect/core'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'

import { SPOTIFY_ENTITY_KIND, spotifyEntityFromUrl, type SpotifyEntityRef } from './entity'

export {
  SPOTIFY_ENTITY_KIND,
  spotifyEntityFromUrl,
  type SpotifyEntityRef,
  type SpotifyEntityKind,
} from './entity'

export const SPOTIFY_WEB_SCOPES = [
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-library-read',
  'user-library-modify',
  'streaming',
  'playlist-read-private',
  'playlist-modify-public',
  'playlist-modify-private',
] as const

export type SpotifyWebScope = (typeof SPOTIFY_WEB_SCOPES)[number]

export type SpotifyAuthSession = BrowserRefreshableTokens

export type SpotifyProfile = PrivateUser

export { readAuthorizationCallback, SpotifyBrowser }

export const spotifyUriFromUrl = (url: string): string | null => {
  const entity = spotifyEntityFromUrl(url)

  if (!entity || entity.kind !== SPOTIFY_ENTITY_KIND.TRACK) return null

  return entity.uri
}

export const spotifyIdFromUrl = (url: string): string | null => {
  const entity = spotifyEntityFromUrl(url)

  if (!entity || entity.kind !== SPOTIFY_ENTITY_KIND.TRACK) return null

  return entity.id
}

export const startSpotifyPkceLoginEffect = Effect.fn('startSpotifyPkceLogin')(function* (
  scopes: ReadonlyArray<SpotifyWebScope>,
  redirectUri: string,
) {
  const spotify = yield* Effect.service(SpotifyBrowser)

  return yield* spotify.auth.startPkceLogin({ scopes, redirectUri })
})

export const exchangeSpotifyPkceCodeEffect = Effect.fn('exchangeSpotifyPkceCode')(function* (
  code: string,
) {
  const spotify = yield* Effect.service(SpotifyBrowser)

  return yield* spotify.auth.exchangeCode(code)
})

export const getValidSpotifyAuthSessionEffect = Effect.fn('getValidSpotifyAuthSession')(
  function* () {
    const spotify = yield* Effect.service(SpotifyBrowser)
    const session = spotify.auth.getTokens()

    if (!session) return undefined

    if (session.accessTokenExpiresAt - Date.now() > 60_000) return session

    return yield* spotify.auth.refreshToken(session.refreshToken)
  },
)

export const fetchSpotifyProfileEffect = Effect.fn('fetchSpotifyProfile')(function* () {
  const spotify = yield* Effect.service(SpotifyBrowser)

  return yield* spotify.users.getCurrentUserProfile()
})

export const logoutSpotifyEffect = Effect.fn('logoutSpotify')(function* () {
  const spotify = yield* Effect.service(SpotifyBrowser)
  spotify.auth.logout()
})

export const playTrackEffect = Effect.fn('playTrack')(function* (spotifyTrackUri: string) {
  const spotify = yield* Effect.service(SpotifyBrowser)
  yield* spotify.player.play({ uris: [spotifyTrackUri] })
})

export const addToQueueEffect = Effect.fn('addToQueue')(function* (spotifyTrackUri: string) {
  const spotify = yield* Effect.service(SpotifyBrowser)
  yield* spotify.player.addToQueue(spotifyTrackUri)
})

export const hasActiveSpotifyDeviceEffect = Effect.fn('hasActiveSpotifyDevice')(function* () {
  const spotify = yield* Effect.service(SpotifyBrowser)
  const devices = yield* spotify.player.getMyDevices()

  return devices.length > 0
})

export type SpotifyPlaybackTarget = {
  readonly id: string
  readonly name: string
  readonly active: boolean
}

export const pickSpotifyPlaybackTarget = (
  devices: ReadonlyArray<Device>,
): SpotifyPlaybackTarget | null => {
  const usable = devices.flatMap((device) =>
    device.id && !device.is_restricted ? [{ ...device, id: device.id }] : [],
  )

  const device =
    usable.find((candidate) => candidate.is_active) ??
    usable.find((candidate) => candidate.type === 'Smartphone') ??
    usable[0]

  return device ? { id: device.id, name: device.name, active: device.is_active } : null
}

export const spotifyPlaybackTargetEffect = Effect.fn('spotifyPlaybackTarget')(function* () {
  const spotify = yield* Effect.service(SpotifyBrowser)

  return pickSpotifyPlaybackTarget(yield* spotify.player.getMyDevices())
})

const QUEUE_PAGE_SIZE = 50

export const collectEntityTrackUrisEffect = Effect.fn('collectEntityTrackUris')(function* (
  entity: SpotifyEntityRef,
) {
  const spotify = yield* Effect.service(SpotifyBrowser)

  if (entity.kind === SPOTIFY_ENTITY_KIND.TRACK) return [entity.uri]

  const uris: Array<string> = []
  let offset = 0

  while (true) {
    const options = { limit: QUEUE_PAGE_SIZE, offset }

    const page =
      entity.kind === SPOTIFY_ENTITY_KIND.ALBUM
        ? yield* spotify.albums
            .getAlbumTracks(entity.id, options)
            .pipe(Effect.map((page) => ({ ...page, uris: page.items.map((track) => track.uri) })))
        : yield* spotify.playlists
            .getPlaylistItems(entity.id, options)
            .pipe(
              Effect.map((page) => ({ ...page, uris: page.items.map((item) => item.track?.uri) })),
            )

    for (const uri of page.uris) {
      if (Schema.is(Schema.String)(uri) && uri.startsWith('spotify:track:')) uris.push(uri)
    }

    if (!page.next || page.items.length === 0) break
    offset += page.items.length
  }

  return uris
})

/**
 * Albums and playlists start as a Spotify playback *context* so the rest of the
 * record keeps playing after the first track; a bare `uris` array would stop dead
 * at the end of it.
 */
export const playSpotifyEntityEffect = Effect.fn('playSpotifyEntity')(function* (
  entity: SpotifyEntityRef,
  deviceId?: string,
) {
  const spotify = yield* Effect.service(SpotifyBrowser)
  const device = deviceId ? { device_id: deviceId } : {}

  if (entity.kind === SPOTIFY_ENTITY_KIND.TRACK) {
    yield* spotify.player.play({ ...device, uris: [entity.uri] })

    return
  }

  yield* spotify.player.play({ ...device, context_uri: entity.uri })
})

export const queueSpotifyEntityEffect = Effect.fn('queueSpotifyEntity')(function* (
  entity: SpotifyEntityRef,
  deviceId?: string,
) {
  const spotify = yield* Effect.service(SpotifyBrowser)
  const uris = yield* collectEntityTrackUrisEffect(entity)

  for (const uri of uris) {
    yield* spotify.player.addToQueue(uri, deviceId ? { device_id: deviceId } : undefined)
  }

  return uris.length
})

export const saveTrackEffect = Effect.fn('saveTrack')(function* (spotifyTrackId: string) {
  const spotify = yield* Effect.service(SpotifyBrowser)
  yield* spotify.library.saveTracks([spotifyTrackId])
})

/** Saves a track or album to the listener's library; playlists cannot be saved this way. */
export const saveSpotifyEntityEffect = Effect.fn('saveSpotifyEntity')(function* (
  entity: SpotifyEntityRef,
) {
  const spotify = yield* Effect.service(SpotifyBrowser)

  if (entity.kind === SPOTIFY_ENTITY_KIND.TRACK) {
    yield* spotify.library.saveTracks([entity.id])

    return true
  }

  if (entity.kind === SPOTIFY_ENTITY_KIND.ALBUM) {
    yield* spotify.library.saveAlbums([entity.id])

    return true
  }

  return false
})

export const checkSavedTracksEffect = Effect.fn('checkSavedTracks')(function* (
  spotifyTrackIds: Array<string>,
) {
  const spotify = yield* Effect.service(SpotifyBrowser)

  if (spotifyTrackIds.length === 0) return new Map<string, boolean>()

  const entries: Array<[string, boolean]> = []

  for (let i = 0; i < spotifyTrackIds.length; i += 50) {
    const batch = spotifyTrackIds.slice(i, i + 50)
    const results = yield* spotify.library.areTracksSaved(batch)

    for (let j = 0; j < batch.length; j += 1) {
      const id = batch[j]

      if (!id) continue
      entries.push([id, results[j] ?? false])
    }
  }

  return new Map(entries)
})

export const checkSavedTrackEffect = Effect.fn('checkSavedTrack')(function* (
  spotifyTrackId: string,
) {
  const results = yield* checkSavedTracksEffect([spotifyTrackId])

  return results.get(spotifyTrackId) ?? false
})

export const isSpotifyForbidden = (error: SpotifyRequestError): boolean =>
  error instanceof SpotifyHttpError && error.status === 403

export const spotifyErrorMessage = (error: SpotifyRequestError): string => {
  if (error instanceof SpotifyHttpError && error.status === 404) return 'No active Spotify device'

  if (error instanceof SpotifyRateLimitError) return 'Too many requests, try again shortly'

  return error.message
}

export type { SpotifyRequestError }
