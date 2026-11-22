import {
  Albums,
  makeSpotifyLayer,
  Playlists,
  Search,
  type SpotifyRequestError,
  Tracks,
  type PlaylistItem,
  type Track as SpotifyTrack,
} from '@planetaryescape/opensound'
import { Context, Effect, Layer, Match } from 'effect'

import {
  MusicProviderInvalidInput,
  MusicProviderMisconfigured,
  MusicProviderNotFound,
  MusicProviderRequestFailed,
  MusicProviderResponseInvalid,
} from '@/errors'
import {
  calculateBandcampTotalDuration,
  extractBandcampArtist,
  getBandcampMetadataWithSpan,
} from '@/services/bandcamp.service'
import { ConfigService } from '@/services/config.service'
import { collectSpotifyTrackPages } from '@/services/spotify-track-pages'
import {
  cleanId,
  extractSpotifyId,
  extractYouTubeId,
  isAppleMusicUrl,
  isBandcampUrl,
  isSpotifyUrl,
  isYouTubeUrl,
} from '@/services/url-utils'

import type { Album, Playlist, SearchAlbumsResponse, Track } from '../routes/spotify/spotify.types'

const SPOTIFY_SEARCH_API_LIMIT = 50

export {
  cleanId,
  extractBandcampId,
  extractSpotifyId,
  extractYouTubeId,
  getIdFromSpotifyUrl,
  isAppleMusicUrl,
  isBandcampUrl,
  isSpotifyUrl,
  isYouTubeUrl,
} from '@/services/url-utils'

export interface SpotifyImportTrack {
  spotifyTrackId: string
  title: string
  artistNames: Array<string>
  artistSpotifyIds: Array<string>
  albumName: string | null
  albumSpotifyId: string | null
  albumImageUrl: string | null
  trackUrl: string
  previewUrl: string | null
  durationMs: number | null
  trackNumber: number | null
}

export interface SpotifyImportPlaylist {
  spotifyPlaylistId: string
  title: string
  description: string | null
  coverImageUrl: string | null
  ownerName: string | null
  playlistUrl: string
  tracks: Array<SpotifyImportTrack>
}

export interface EnrichedTrack {
  title: string
  artist: string
  url: string
  platform: 'spotify' | 'youtube' | 'apple_music' | 'bandcamp' | 'other'
  thumbnailUrl?: string | undefined
  album?: string | undefined
  duration?: number | undefined
}

export type SpotifySourceEntityType = 'track' | 'album' | 'playlist'

export type ResolveSpotifySourceInput = {
  readonly entityType: SpotifySourceEntityType
  readonly urlOrId: string
}

export type SpotifyServiceError =
  | MusicProviderInvalidInput
  | MusicProviderNotFound
  | MusicProviderMisconfigured
  | MusicProviderRequestFailed
  | MusicProviderResponseInvalid

type SpotifySourceCandidateBase = {
  readonly platform: 'spotify'
  readonly externalId: string
  readonly title: string
  readonly url: string
  readonly imageUrl?: string | undefined
}

export type SpotifySourceCandidate =
  | (SpotifySourceCandidateBase & {
      readonly entityType: 'track'
      readonly artists: string
      readonly isrc?: string | undefined
      readonly crossPlatformEnrichment: 'allowed'
    })
  | (SpotifySourceCandidateBase & {
      readonly entityType: 'album'
      readonly artists: string
      readonly crossPlatformEnrichment: 'allowed'
    })
  | (SpotifySourceCandidateBase & {
      readonly entityType: 'playlist'
      readonly description?: string | undefined
      readonly ownerName?: string | undefined
      readonly crossPlatformEnrichment: 'forbidden'
    })

export interface SpotifyService {
  readonly getTrack: (id: string) => Effect.Effect<Track, SpotifyServiceError>
  readonly getAlbum: (id: string) => Effect.Effect<Album, SpotifyServiceError>
  readonly getPlaylist: (id: string) => Effect.Effect<Playlist, SpotifyServiceError>
  readonly getPlaylistForImport: (
    id: string,
  ) => Effect.Effect<SpotifyImportPlaylist, SpotifyServiceError>
  readonly getTrackForImport: (id: string) => Effect.Effect<SpotifyImportTrack, SpotifyServiceError>
  readonly searchAlbums: (
    query: string,
    limit?: number,
    offset?: number,
  ) => Effect.Effect<SearchAlbumsResponse, SpotifyServiceError>
  readonly searchTrackByIsrc: (
    isrc: string,
  ) => Effect.Effect<
    { id: string; url: string; title: string; artist: string } | null,
    SpotifyServiceError
  >
  readonly searchAlbumByTitleArtist: (
    title: string,
    artist: string,
  ) => Effect.Effect<
    { id: string; url: string; title: string; artist: string } | null,
    SpotifyServiceError
  >
  readonly enrichTrackFromUrl: (url: string) => Effect.Effect<EnrichedTrack, SpotifyServiceError>
  readonly resolveSource: (
    input: ResolveSpotifySourceInput,
  ) => Effect.Effect<SpotifySourceCandidate, SpotifyServiceError>
}

export const SpotifyService = Context.Service<SpotifyService>('SpotifyService')

const describeSpotifyRequestError = (error: SpotifyRequestError) => {
  return Match.value(error).pipe(
    Match.tag(
      'SpotifyHttpError',
      (failure) => failure.apiMessage ?? failure.description ?? `HTTP ${failure.status}`,
    ),
    Match.tag(
      'SpotifyRateLimitError',
      (failure) => `Rate limited, retry after ${failure.retryAfterSeconds}s`,
    ),
    Match.tag('SpotifyConfigurationError', (failure) => failure.message),
    Match.orElse((failure) => failure.description ?? String(failure.cause)),
  )
}

type SpotifyEntityRef = {
  readonly entityType: string
  readonly externalId: string
}

const toProviderError =
  (operation: string, prefix: string, entity?: SpotifyEntityRef) =>
  (error: SpotifyRequestError) => {
    const message = `${prefix}: ${describeSpotifyRequestError(error)}`

    return Match.value(error).pipe(
      Match.tag(
        'SpotifyConfigurationError',
        () => new MusicProviderMisconfigured({ message, operation }),
      ),
      Match.tag(
        'SpotifyParseError',
        () => new MusicProviderResponseInvalid({ message, operation }),
      ),
      Match.tag(
        'SpotifyRateLimitError',
        () => new MusicProviderRequestFailed({ message, operation, statusCode: 429 }),
      ),
      Match.tag('SpotifyHttpError', (failure) =>
        failure.status === 404 && entity
          ? new MusicProviderNotFound({
              operation,
              entityType: entity.entityType,
              externalId: entity.externalId,
            })
          : new MusicProviderRequestFailed({ message, operation, statusCode: failure.status }),
      ),
      Match.orElse(() => new MusicProviderRequestFailed({ message, operation })),
    )
  }

export const normalizeSpotifyIsrc = (isrc: string) =>
  isrc.toLocaleUpperCase('en').replace(/[^A-Z0-9]/g, '')

export const normalizeSpotifyMetadata = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

export const isExactSpotifyIsrcMatch = (requested: string, returned: string | undefined) =>
  returned !== undefined && normalizeSpotifyIsrc(returned) === normalizeSpotifyIsrc(requested)

export const isExactSpotifyAlbumMatch = (
  requestedTitle: string,
  requestedArtist: string,
  returnedTitle: string,
  returnedArtists: ReadonlyArray<string>,
) =>
  normalizeSpotifyMetadata(returnedTitle) === normalizeSpotifyMetadata(requestedTitle) &&
  returnedArtists.some(
    (artist) => normalizeSpotifyMetadata(artist) === normalizeSpotifyMetadata(requestedArtist),
  )

const SPOTIFY_ID_PATTERN = /^[a-zA-Z0-9]{22}$/

const parseSpotifySourceId = ({ entityType, urlOrId }: ResolveSpotifySourceInput) => {
  const input = urlOrId.trim()

  if (SPOTIFY_ID_PATTERN.test(input)) return input

  let url: URL

  try {
    url = new URL(input)
  } catch {
    return null
  }

  if (url.protocol !== 'https:' || url.hostname !== 'open.spotify.com') return null

  const pathSegments = url.pathname.split('/').filter(Boolean)

  if (pathSegments.length !== 2 || pathSegments[0] !== entityType) return null

  const id = pathSegments[1]

  return id && SPOTIFY_ID_PATTERN.test(id) ? id : null
}

type SpotifySourceLookups = Pick<SpotifyService, 'getTrack' | 'getAlbum' | 'getPlaylist'>

export const resolveSpotifySourceEffect = (
  spotify: SpotifySourceLookups,
  input: ResolveSpotifySourceInput,
): Effect.Effect<SpotifySourceCandidate, SpotifyServiceError> =>
  Effect.gen(function* () {
    const externalId = parseSpotifySourceId(input)

    if (!externalId) {
      return yield* new MusicProviderInvalidInput({
        message: `Invalid Spotify ${input.entityType} URL or ID`,
        operation: 'resolveSource',
      })
    }

    switch (input.entityType) {
      case 'track': {
        const track = yield* spotify.getTrack(externalId)

        return {
          platform: 'spotify',
          entityType: 'track',
          externalId,
          title: track.title,
          artists: track.artists,
          isrc: track.isrc,
          url: track.trackUrl,
          imageUrl: track.albumImageUrl,
          crossPlatformEnrichment: 'allowed',
        }
      }

      case 'album': {
        const album = yield* spotify.getAlbum(externalId)

        return {
          platform: 'spotify',
          entityType: 'album',
          externalId,
          title: album.title,
          artists: album.artists,
          url: album.albumUrl,
          imageUrl: album.albumImageUrl,
          crossPlatformEnrichment: 'allowed',
        }
      }

      case 'playlist': {
        const playlist = yield* spotify.getPlaylist(externalId)

        return {
          platform: 'spotify',
          entityType: 'playlist',
          externalId,
          title: playlist.title,
          url: playlist.playlistUrl,
          imageUrl: playlist.coverImageUrl,
          description: playlist.description,
          ownerName: playlist.ownerName,
          crossPlatformEnrichment: 'forbidden',
        }
      }

      default: {
        const unexpectedEntityType: never = input.entityType

        return unexpectedEntityType
      }
    }
  })

const isPlaylistTrack = (item: PlaylistItem['track']): item is SpotifyTrack =>
  'type' in item && item.type === 'track'

const playlistTracks = (items: ReadonlyArray<PlaylistItem>): Array<SpotifyTrack> =>
  items.flatMap((item) => (isPlaylistTrack(item.track) ? [item.track] : []))

const joinArtistNames = (artists: ReadonlyArray<{ name: string }>) =>
  artists.map((artist) => artist.name).join(', ')

const toImportTrack = (track: SpotifyTrack): SpotifyImportTrack => ({
  spotifyTrackId: track.id,
  title: track.name,
  artistNames: track.artists.map((artist) => artist.name),
  artistSpotifyIds: track.artists.map((artist) => artist.id).filter(Boolean),
  albumName: track.album?.name ?? null,
  albumSpotifyId: track.album?.id ?? null,
  albumImageUrl: track.album?.images?.[0]?.url ?? null,
  trackUrl: track.external_urls.spotify ?? '',
  previewUrl: track.preview_url ?? null,
  durationMs: track.duration_ms ?? null,
  trackNumber: track.track_number ?? null,
})

const getTrackEffect = (id: string) =>
  Effect.gen(function* () {
    const sanitizedId = cleanId(id)

    if (!id || !sanitizedId) {
      return yield* new MusicProviderInvalidInput({
        message: 'Invalid track ID provided',
        operation: 'getTrack',
      })
    }

    const tracks = yield* Tracks

    const data = yield* tracks.getTrack(sanitizedId).pipe(
      Effect.mapError(
        toProviderError('getTrack', 'Failed to fetch track', {
          entityType: 'track',
          externalId: sanitizedId,
        }),
      ),
    )

    const track: Track = {
      albumType: data.album?.album_type,
      albumImageUrl: data.album?.images[0]?.url,
      title: data.name,
      artists: joinArtistNames(data.artists),
      trackUrl: data.external_urls.spotify ?? '',
      isrc: data.external_ids.isrc,
      previewUrl: data.preview_url ?? undefined,
    }

    return track
  })

const getAlbumEffect = (id: string) =>
  Effect.gen(function* () {
    const sanitizedId = cleanId(id)

    if (!id || !sanitizedId) {
      return yield* new MusicProviderInvalidInput({
        message: 'Invalid album ID provided',
        operation: 'getAlbum',
      })
    }

    const albums = yield* Albums

    const data = yield* albums.getAlbum(sanitizedId).pipe(
      Effect.mapError(
        toProviderError('getAlbum', 'Failed to fetch album', {
          entityType: 'album',
          externalId: sanitizedId,
        }),
      ),
    )

    const tracks = yield* collectSpotifyTrackPages(data.tracks, (options) =>
      albums.getAlbumTracks(sanitizedId, options),
    ).pipe(
      Effect.mapError(
        toProviderError('getAlbum', 'Failed to fetch album', {
          entityType: 'album',
          externalId: sanitizedId,
        }),
      ),
    )

    const album: Album = {
      albumType: data.album_type,
      albumImageUrl: data.images[0]?.url,
      title: data.name,
      artists: joinArtistNames(data.artists),
      tracks: tracks.map((track) => ({
        title: track.name,
        artists: joinArtistNames(track.artists),
        previewUrl: track.preview_url ?? undefined,
        trackUrl: track.external_urls.spotify ?? '',
      })),
      albumUrl: data.external_urls.spotify ?? '',
    }

    return album
  })

const getPlaylistEffect = (id: string) =>
  Effect.gen(function* () {
    const sanitizedId = cleanId(id)

    if (!id || !sanitizedId) {
      return yield* new MusicProviderInvalidInput({
        message: 'Invalid playlist ID provided',
        operation: 'getPlaylist',
      })
    }

    const playlists = yield* Playlists

    const data = yield* playlists.getPlaylist(sanitizedId).pipe(
      Effect.mapError(
        toProviderError('getPlaylist', 'Failed to fetch playlist', {
          entityType: 'playlist',
          externalId: sanitizedId,
        }),
      ),
    )

    const items = yield* collectSpotifyTrackPages(data.tracks, (options) =>
      playlists.getPlaylistItems(sanitizedId, options),
    ).pipe(
      Effect.mapError(
        toProviderError('getPlaylist', 'Failed to fetch playlist', {
          entityType: 'playlist',
          externalId: sanitizedId,
        }),
      ),
    )

    const playlist: Playlist = {
      coverImageUrl: data.images[0]?.url,
      title: data.name,
      description: data.description ?? undefined,
      tracks: playlistTracks(items).map((track) => ({
        title: track.name,
        artists: joinArtistNames(track.artists),
        previewUrl: track.preview_url ?? undefined,
        trackUrl: track.external_urls.spotify ?? '',
      })),
      ownerName: data.owner.display_name ?? undefined,
      playlistUrl: data.external_urls.spotify ?? '',
    }

    return playlist
  })

const PLAYLIST_IMPORT_CACHE_TTL_MS = 60 * 60 * 1000

const playlistImportCache = new Map<string, { value: SpotifyImportPlaylist; expiresAt: number }>()

const getPlaylistForImportEffect = (id: string) =>
  Effect.gen(function* () {
    const sanitizedId = cleanId(id)

    if (!id || !sanitizedId) {
      return yield* new MusicProviderInvalidInput({
        message: 'Invalid playlist ID provided',
        operation: 'getPlaylistForImport',
      })
    }

    const now = Date.now()
    const cached = playlistImportCache.get(sanitizedId)

    if (cached && cached.expiresAt > now) {
      return cached.value
    }

    const playlists = yield* Playlists

    const data = yield* playlists.getPlaylist(sanitizedId).pipe(
      Effect.mapError(
        toProviderError('getPlaylistForImport', 'Failed to fetch playlist', {
          entityType: 'playlist',
          externalId: sanitizedId,
        }),
      ),
    )

    const tracks: Array<SpotifyImportTrack> = playlistTracks(data.tracks.items).map(toImportTrack)

    const result: SpotifyImportPlaylist = {
      spotifyPlaylistId: data.id,
      title: data.name,
      description: data.description ?? null,
      coverImageUrl: data.images?.[0]?.url ?? null,
      ownerName: data.owner.display_name ?? null,
      playlistUrl: data.external_urls.spotify ?? '',
      tracks,
    }

    playlistImportCache.set(sanitizedId, {
      value: result,
      expiresAt: now + PLAYLIST_IMPORT_CACHE_TTL_MS,
    })

    return result
  })

const searchAlbumsEffect = (query: string, limit = 10, offset = 0) =>
  Effect.gen(function* () {
    if (!query || query.trim() === '') {
      return yield* new MusicProviderInvalidInput({
        message: 'Search query is required',
        operation: 'searchAlbums',
      })
    }

    const validatedLimit = Math.min(Math.max(1, limit), SPOTIFY_SEARCH_API_LIMIT)

    const search = yield* Search

    const data = yield* search
      .search(query, ['album'], { limit: SPOTIFY_SEARCH_API_LIMIT, offset })
      .pipe(Effect.mapError(toProviderError('searchAlbums', 'Failed to search albums')))

    const searchResponse: SearchAlbumsResponse = {
      albums: (data.albums?.items ?? []).slice(0, validatedLimit).map((album) => ({
        id: album.id,
        title: album.name,
        artists: joinArtistNames(album.artists),
        albumType: album.album_type,
        releaseDate: album.release_date,
        albumImageUrl: album.images[0]?.url,
        albumUrl: album.external_urls.spotify ?? '',
        totalTracks: album.total_tracks,
      })),
      total: data.albums?.total ?? 0,
      limit: validatedLimit,
      offset: data.albums?.offset ?? offset,
    }

    return searchResponse
  })

const searchTrackByIsrcEffect = (isrc: string) =>
  Effect.gen(function* () {
    if (!isrc || isrc.trim() === '') {
      return yield* new MusicProviderInvalidInput({
        message: 'ISRC is required',
        operation: 'searchTrackByIsrc',
      })
    }

    const search = yield* Search

    const data = yield* search
      .search(`isrc:${isrc}`, ['track'], { limit: 1 })
      .pipe(Effect.mapError(toProviderError('searchTrackByIsrc', 'Failed to search track by ISRC')))

    const track = data.tracks?.items[0]

    if (!track || !isExactSpotifyIsrcMatch(isrc, track.external_ids.isrc)) return null

    return {
      id: track.id,
      url: track.external_urls.spotify ?? '',
      title: track.name,
      artist: joinArtistNames(track.artists),
    }
  })

const searchAlbumByTitleArtistEffect = (title: string, artist: string) =>
  Effect.gen(function* () {
    if (!title || title.trim() === '') {
      return yield* new MusicProviderInvalidInput({
        message: 'Album title is required',
        operation: 'searchAlbumByTitleArtist',
      })
    }

    const query = artist ? `album:${title} artist:${artist}` : `album:${title}`

    const search = yield* Search

    const data = yield* search
      .search(query, ['album'], { limit: 1 })
      .pipe(
        Effect.mapError(
          toProviderError('searchAlbumByTitleArtist', 'Failed to search album by title/artist'),
        ),
      )

    const album = data.albums?.items[0]

    if (
      !album ||
      !isExactSpotifyAlbumMatch(
        title,
        artist,
        album.name,
        album.artists.map((albumArtist) => albumArtist.name),
      )
    )
      return null

    return {
      id: album.id,
      url: album.external_urls.spotify ?? '',
      title: album.name,
      artist: joinArtistNames(album.artists),
    }
  })

const searchTrackByIsrcWithSpan = (isrc: string) =>
  searchTrackByIsrcEffect(isrc).pipe(
    Effect.withSpan('spotify.searchTrackByIsrc', {
      attributes: { 'spotify.isrc': isrc, 'external.system': 'spotify' },
    }),
  )

const searchAlbumByTitleArtistWithSpan = (title: string, artist: string) =>
  searchAlbumByTitleArtistEffect(title, artist).pipe(
    Effect.withSpan('spotify.searchAlbumByTitleArtist', {
      attributes: {
        'spotify.title': title,
        'spotify.artist': artist,
        'external.system': 'spotify',
      },
    }),
  )

const getTrackWithSpan = (id: string) =>
  getTrackEffect(id).pipe(
    Effect.withSpan('spotify.getTrack', {
      attributes: { 'spotify.id': id, 'external.system': 'spotify' },
    }),
  )

const getAlbumWithSpan = (id: string) =>
  getAlbumEffect(id).pipe(
    Effect.withSpan('spotify.getAlbum', {
      attributes: { 'spotify.id': id, 'external.system': 'spotify' },
    }),
  )

const getPlaylistWithSpan = (id: string) =>
  getPlaylistEffect(id).pipe(
    Effect.withSpan('spotify.getPlaylist', {
      attributes: { 'spotify.id': id, 'external.system': 'spotify' },
    }),
  )

const getTrackForImportEffect = (id: string) =>
  Effect.gen(function* () {
    const sanitizedId = cleanId(id)

    if (!id || !sanitizedId) {
      return yield* new MusicProviderInvalidInput({
        message: 'Invalid track ID provided',
        operation: 'getTrackForImport',
      })
    }

    const tracks = yield* Tracks

    const data = yield* tracks.getTrack(sanitizedId).pipe(
      Effect.mapError(
        toProviderError('getTrackForImport', 'Failed to fetch track', {
          entityType: 'track',
          externalId: sanitizedId,
        }),
      ),
    )

    return toImportTrack(data)
  })

const getTrackForImportWithSpan = (id: string) =>
  getTrackForImportEffect(id).pipe(
    Effect.withSpan('spotify.getTrackForImport', {
      attributes: { 'spotify.id': id, 'external.system': 'spotify' },
    }),
  )

const getPlaylistForImportWithSpan = (id: string) =>
  getPlaylistForImportEffect(id).pipe(
    Effect.withSpan('spotify.getPlaylistForImport', {
      attributes: { 'spotify.id': id, 'external.system': 'spotify' },
    }),
  )

const searchAlbumsWithSpan = (query: string, limit = 10, offset = 0) =>
  searchAlbumsEffect(query, limit, offset).pipe(
    Effect.withSpan('spotify.searchAlbums', {
      attributes: {
        'spotify.query_length': query.length,
        'spotify.limit': limit,
        'spotify.offset': offset,
        'external.system': 'spotify',
      },
    }),
  )

const enrichTrackFromUrlWithSpan = (url: string) =>
  Effect.gen(function* () {
    const platform = isSpotifyUrl(url)
      ? 'spotify'
      : isYouTubeUrl(url)
        ? 'youtube'
        : isAppleMusicUrl(url)
          ? 'apple_music'
          : isBandcampUrl(url)
            ? 'bandcamp'
            : 'other'

    yield* Effect.annotateCurrentSpan('music.platform', platform)

    let result: EnrichedTrack

    if (isSpotifyUrl(url)) {
      const id = extractSpotifyId(url)

      if (!id) {
        return yield* new MusicProviderInvalidInput({
          message: 'Invalid Spotify URL',
          operation: 'enrichTrackFromUrl',
        })
      }

      yield* Effect.annotateCurrentSpan('spotify.id', id)
      yield* Effect.annotateCurrentSpan('url.type', url.includes('/album/') ? 'album' : 'track')

      if (url.includes('/album/')) {
        const albums = yield* Albums

        const data = yield* albums.getAlbum(id).pipe(
          Effect.mapError(
            toProviderError('enrichTrackFromUrl', 'Failed to fetch Spotify album', {
              entityType: 'album',
              externalId: id,
            }),
          ),
        )

        result = {
          title: data.name,
          artist: joinArtistNames(data.artists),
          url: data.external_urls.spotify ?? '',
          platform: 'spotify',
          thumbnailUrl: data.images[0]?.url,
          album: data.name,
          duration: data.tracks.items.reduce((total, track) => total + track.duration_ms, 0) / 1000,
        }
      } else {
        const tracks = yield* Tracks

        const data = yield* tracks.getTrack(id).pipe(
          Effect.mapError(
            toProviderError('enrichTrackFromUrl', 'Failed to fetch Spotify track', {
              entityType: 'track',
              externalId: id,
            }),
          ),
        )

        result = {
          title: data.name,
          artist: joinArtistNames(data.artists),
          url: data.external_urls.spotify ?? '',
          platform: 'spotify',
          thumbnailUrl: data.album.images[0]?.url,
          album: data.album.name,
          duration: Math.floor(data.duration_ms / 1000),
        }
      }
    } else if (isYouTubeUrl(url)) {
      const videoId = extractYouTubeId(url)

      if (!videoId) {
        return yield* new MusicProviderInvalidInput({
          message: 'Invalid YouTube URL',
          operation: 'enrichTrackFromUrl',
        })
      }

      result = {
        title: 'YouTube Video',
        artist: 'Unknown Artist',
        url: `https://www.youtube.com/watch?v=${videoId}`,
        platform: 'youtube',
        thumbnailUrl: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
      }
    } else if (isAppleMusicUrl(url)) {
      result = {
        title: 'Apple Music Track',
        artist: 'Unknown Artist',
        url: url,
        platform: 'apple_music',
      }
    } else if (isBandcampUrl(url)) {
      const metadata = yield* getBandcampMetadataWithSpan(url)

      result = {
        title: metadata.name,
        artist: extractBandcampArtist(metadata),
        url: url,
        platform: 'bandcamp',
        thumbnailUrl: metadata.image,
        album: metadata.name,
        duration: calculateBandcampTotalDuration(metadata),
      }
    } else {
      result = {
        title: 'External Track',
        artist: 'Unknown Artist',
        url: url,
        platform: 'other',
      }
    }

    return result
  }).pipe(Effect.withSpan('spotify.enrichTrackFromUrl'))

export const SpotifyServiceLayer = Layer.effect(
  SpotifyService,
  Effect.gen(function* () {
    const config = yield* ConfigService

    const spotifyLayer = makeSpotifyLayer({
      clientId: config.spotify.clientId,
      clientSecret: config.spotify.clientSecret,
    })

    const context = yield* Layer.build(spotifyLayer)

    const provide = <A, E>(effect: Effect.Effect<A, E, Tracks | Albums | Playlists | Search>) =>
      Effect.provide(effect, context)

    const service: SpotifyService = {
      getTrack: (id) => provide(getTrackWithSpan(id)),
      getAlbum: (id) => provide(getAlbumWithSpan(id)),
      getPlaylist: (id) => provide(getPlaylistWithSpan(id)),
      getPlaylistForImport: (id) => provide(getPlaylistForImportWithSpan(id)),
      getTrackForImport: (id) => provide(getTrackForImportWithSpan(id)),
      searchAlbums: (query, limit, offset) => provide(searchAlbumsWithSpan(query, limit, offset)),
      searchTrackByIsrc: (isrc) => provide(searchTrackByIsrcWithSpan(isrc)),
      searchAlbumByTitleArtist: (title, artist) =>
        provide(searchAlbumByTitleArtistWithSpan(title, artist)),
      enrichTrackFromUrl: (url) => provide(enrichTrackFromUrlWithSpan(url)),
      resolveSource: (input) =>
        resolveSpotifySourceEffect(service, input).pipe(
          Effect.withSpan('spotify.resolveSource', {
            attributes: {
              'spotify.entity_type': input.entityType,
              'external.system': 'spotify',
            },
          }),
        ),
    }

    return service
  }),
)
