import { Api } from '@gbfm/api/api'
import { AuthSession } from '@gbfm/api/middleware/auth'
import { MusicServiceUnavailableResponse } from '@gbfm/api/music'
import type {
  AlbumResponse,
  ArtistResponse,
  CreateAlbumInput,
  CreateArtistInput,
  CreateLabelInput,
  CreatePlaylistInput,
  CreateTrackInput,
  EntityLinkResponse,
  LabelResponse,
  PlaylistResponse,
  ResolvedMusicEntityResponse,
  ScrapeMusicEntityResponse,
  TrackResponse,
  UpdateAlbumInput,
  UpdateArtistInput,
  UpdateLabelInput,
  UpdatePlaylistInput,
  UpdateTrackInput,
} from '@gbfm/api/music'
import { ValidationHttpError } from '@gbfm/api/post'
import { Effect, Schema } from 'effect'
import { HttpApiBuilder, HttpApiError } from 'effect/http-api'

import type {
  SelectMusicAlbum,
  SelectMusicArtist,
  SelectMusicEntityLink,
  SelectMdxCompiledMusicLabel,
  SelectMusicLabel,
  SelectMusicPlaylist,
  SelectMusicTrack,
} from '@/db/music-entity.schema'
import type { PlaylistEnrichmentQueueUnavailable } from '@/errors'
import { dieOnDatabaseError as makeDieOnDatabaseError } from '@/http/handler-utils'
import {
  mapMusicIdentityErrors,
  mapSpotifyTrackImportErrors,
  PROVIDER_UNAVAILABLE_RETRY_AFTER_SECONDS,
} from '@/http/music-identity-http'
import {
  mapMusicWriteErrors,
  musicBodyWriteRequest,
  musicHeaderWriteRequest,
  musicReferenceHeaderWriteRequest,
} from '@/http/music-write-http'
import { omitUndefined } from '@/lib/omit-undefined'
import {
  CanonicalMusicIdentity,
  type AnyResolvedMusicEntity,
} from '@/services/canonical-music-identity'
import {
  type CreateAlbumInput as AlbumServiceCreateInput,
  type CreateArtistInput as ArtistServiceCreateInput,
  type CreateLabelInput as LabelServiceCreateInput,
  type CreatePlaylistInput as PlaylistServiceCreateInput,
  type CreateTrackInput as TrackServiceCreateInput,
  MusicEntityService,
  type ScrapedMusicEntity,
} from '@/services/music-entity'
import {
  getReadablePlaylistsEffect,
  getReadablePlaylistByIdEffect,
} from '@/services/music-entity/playlist.service'
import {
  PlaylistEnrichmentJob,
  PlaylistEnrichmentQueue,
} from '@/services/playlist-enrichment-queue'
import { getIdFromSpotifyUrl } from '@/services/url-utils'

import { resolvePageSession } from './page-session'

const decodeMusicEntityMetadata = Schema.decodeUnknownSync(Schema.JsonObject)

const toArtistResponse = (row: SelectMusicArtist): ArtistResponse => ({
  ...row,
  publishedAt: row.publishedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

const toAlbumResponse = (row: SelectMusicAlbum): AlbumResponse => ({
  ...row,
  releaseDate: row.releaseDate?.toISOString() ?? null,
  publishedAt: row.publishedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

const toTrackResponse = (row: SelectMusicTrack): TrackResponse => ({
  ...row,
  publishedAt: row.publishedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

const toPlaylistResponse = (
  row: SelectMusicPlaylist & { spotifyUrl?: string | null },
): PlaylistResponse => ({
  ...row,
  publishedAt: row.publishedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

const toLabelResponse = (row: SelectMusicLabel | SelectMdxCompiledMusicLabel): LabelResponse => ({
  ...row,
  tags: row.tags ? [...row.tags] : null,
  genres: row.genres ? [...row.genres] : null,
  publishedAt: row.publishedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

const toEntityLinkResponse = (row: SelectMusicEntityLink): EntityLinkResponse => ({
  ...row,
  scrapedAt: row.scrapedAt?.toISOString() ?? null,
  verifiedAt: row.verifiedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

const unreachableEntityType = (entityType: never): never => {
  throw new Error(`Unexpected canonical music entity type: ${String(entityType)}`)
}

const toResolvedMusicEntityResponse = (
  resolved: AnyResolvedMusicEntity,
): ResolvedMusicEntityResponse => {
  const links = resolved.links.map(toEntityLinkResponse)

  switch (resolved.entityType) {
    case 'artist':
      return {
        entityType: 'artist',
        entity: toArtistResponse(resolved.entity),
        links,
        coverImageUrl: resolved.entity.imageUrl,
      }
    case 'album':
      return {
        entityType: 'album',
        entity: toAlbumResponse(resolved.entity),
        links,
        coverImageUrl: resolved.entity.coverImageUrl,
      }
    case 'track':
      return {
        entityType: 'track',
        entity: toTrackResponse(resolved.entity),
        links,
        coverImageUrl: resolved.entity.coverImageUrl,
      }
    case 'playlist':
      return {
        entityType: 'playlist',
        entity: toPlaylistResponse(resolved.entity),
        links,
        coverImageUrl: resolved.entity.coverImageUrl,
      }
    default:
      return unreachableEntityType(resolved)
  }
}

const toScrapeMusicEntityResponse = (
  result: AnyResolvedMusicEntity | ScrapedMusicEntity,
): ScrapeMusicEntityResponse => {
  switch (result.entityType) {
    case 'artist':
      return toArtistResponse(result.entity)
    case 'album':
      return toAlbumResponse(result.entity)
    case 'track':
      return toTrackResponse(result.entity)
    case 'playlist':
      return toPlaylistResponse(result.entity)
    default:
      return unreachableEntityType(result)
  }
}

function toServiceFields(input: CreateArtistInput): ArtistServiceCreateInput
function toServiceFields(input: UpdateArtistInput): Partial<ArtistServiceCreateInput>
function toServiceFields(
  input: CreateArtistInput | UpdateArtistInput,
): Partial<ArtistServiceCreateInput> {
  return omitUndefined({
    name: input.name,
    bio: input.bio,
    imageUrl: input.imageUrl,
    slug: input.slug,
    genres: input.genres ? [...input.genres] : undefined,
    publishedAt: input.publishedAt ? new Date(input.publishedAt) : undefined,
  })
}

// Create: title/slug are required NonEmptyString on the wire schema, so no
// null-coercion is needed -- only the array/date fields need reshaping.
const toAlbumCreateFields = (input: CreateAlbumInput): AlbumServiceCreateInput =>
  omitUndefined({
    ...input,
    artistNames: input.artistNames ? [...input.artistNames] : undefined,
    artistIds: input.artistIds ? [...input.artistIds] : undefined,
    genres: input.genres ? [...input.genres] : undefined,
    releaseDate: input.releaseDate ? new Date(input.releaseDate) : undefined,
    publishedAt: input.publishedAt ? new Date(input.publishedAt) : undefined,
  })

// Update: every field (including title/slug) is optional+nullable on the
// wire schema since the admin form submits full state, not a diff. The DB
// columns are non-nullable, so a null here means "no change", not "clear
// this field" -- coerced to undefined before reaching the service.
const toAlbumUpdateFields = (input: UpdateAlbumInput): Partial<AlbumServiceCreateInput> =>
  omitUndefined({
    ...input,
    title: input.title ?? undefined,
    slug: input.slug ?? undefined,
    artistNames: input.artistNames ? [...input.artistNames] : undefined,
    artistIds: input.artistIds ? [...input.artistIds] : undefined,
    genres: input.genres ? [...input.genres] : undefined,
    releaseDate: input.releaseDate ? new Date(input.releaseDate) : undefined,
    publishedAt: input.publishedAt ? new Date(input.publishedAt) : undefined,
  })

const toTrackCreateFields = (input: CreateTrackInput): TrackServiceCreateInput =>
  omitUndefined({
    ...input,
    artistNames: input.artistNames ? [...input.artistNames] : undefined,
    artistIds: input.artistIds ? [...input.artistIds] : undefined,
    publishedAt: input.publishedAt ? new Date(input.publishedAt) : undefined,
  })

const toTrackUpdateFields = (input: UpdateTrackInput): Partial<TrackServiceCreateInput> =>
  omitUndefined({
    ...input,
    title: input.title ?? undefined,
    slug: input.slug ?? undefined,
    artistNames: input.artistNames ? [...input.artistNames] : undefined,
    artistIds: input.artistIds ? [...input.artistIds] : undefined,
    publishedAt: input.publishedAt ? new Date(input.publishedAt) : undefined,
  })

const toPlaylistCreateFields = (input: CreatePlaylistInput): PlaylistServiceCreateInput =>
  omitUndefined({
    ...input,
    publishedAt: input.publishedAt ? new Date(input.publishedAt) : undefined,
  })

const toPlaylistUpdateFields = (input: UpdatePlaylistInput): Partial<PlaylistServiceCreateInput> =>
  omitUndefined({
    ...input,
    title: input.title ?? undefined,
    slug: input.slug ?? undefined,
    publishedAt: input.publishedAt ? new Date(input.publishedAt) : undefined,
  })

const toLabelCreateFields = (input: CreateLabelInput): LabelServiceCreateInput =>
  omitUndefined({
    ...input,
    tags: input.tags ? [...input.tags] : undefined,
    genres: input.genres ? [...input.genres] : undefined,
    publishedAt: input.publishedAt ? new Date(input.publishedAt) : undefined,
  })

const toLabelUpdateFields = (input: UpdateLabelInput): Partial<LabelServiceCreateInput> =>
  omitUndefined({
    ...input,
    name: input.name ?? undefined,
    slug: input.slug ?? undefined,
    content: input.content ?? undefined,
    tags: input.tags ? [...input.tags] : input.tags,
    genres: input.genres ? [...input.genres] : input.genres,
    publishedAt:
      input.publishedAt === null
        ? null
        : input.publishedAt
          ? new Date(input.publishedAt)
          : undefined,
  })

const dieOnDatabaseError = makeDieOnDatabaseError('music')

// A music provider failure is an infra failure (network/API), not
// client-fixable by resubmitting differently, except where the handler
// already validates the URL shape itself (importSpotifyPlaylist) -- same
// convention as dieOnDatabaseError/dieOnS3Error in handler-utils.ts.
const requireAdmin = Effect.gen(function* () {
  const { user } = yield* AuthSession

  if (user.role !== 'admin') {
    return yield* new HttpApiError.Forbidden()
  }

  return undefined
})

const enqueuePlaylistJob = <A, E, R>(
  effect: Effect.Effect<A, E | PlaylistEnrichmentQueueUnavailable, R>,
) =>
  effect.pipe(
    Effect.catchTag(
      'PlaylistEnrichmentQueueUnavailable',
      () =>
        new MusicServiceUnavailableResponse({
          retryAfterSeconds: PROVIDER_UNAVAILABLE_RETRY_AFTER_SECONDS,
        }),
    ),
  )

export const MusicHandlersLive = HttpApiBuilder.group(Api, 'music', (handlers) =>
  handlers
    .handle('listArtists', () =>
      Effect.gen(function* () {
        const svc = yield* MusicEntityService
        const rows = yield* dieOnDatabaseError(svc.getArtists)

        return rows.map(toArtistResponse)
      }),
    )
    .handle('createArtist', ({ payload }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        const { user } = yield* AuthSession
        const svc = yield* MusicEntityService

        const row = yield* dieOnDatabaseError(
          svc.createArtist(omitUndefined({ ...toServiceFields(payload), createdById: user.id })),
        )

        return toArtistResponse(row)
      }),
    )
    .handle('getArtist', ({ params }) =>
      Effect.gen(function* () {
        const svc = yield* MusicEntityService

        const row = yield* dieOnDatabaseError(
          svc
            .getArtistById(params.id)
            .pipe(Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound())),
        )

        return toArtistResponse(row)
      }),
    )
    .handle('updateArtist', ({ params, payload }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        const svc = yield* MusicEntityService
        const write = yield* musicBodyWriteRequest(payload)

        const row = yield* mapMusicWriteErrors(
          svc.updateArtist(params.id, omitUndefined(toServiceFields(payload)), write),
        )

        return toArtistResponse(row)
      }),
    )
    .handle('deleteArtist', ({ params, headers }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        const svc = yield* MusicEntityService
        const write = yield* musicHeaderWriteRequest(headers)
        yield* mapMusicWriteErrors(svc.deleteArtist(params.id, write))
      }),
    )
    .handle('listArtistLabels', ({ params }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        const svc = yield* MusicEntityService
        const rows = yield* dieOnDatabaseError(svc.getLabelsForArtist(params.artistId))

        return rows.map(toLabelResponse)
      }),
    )
    .handle('addArtistToAlbum', ({ params, payload }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        const svc = yield* MusicEntityService
        const write = yield* musicBodyWriteRequest(payload)
        yield* mapMusicWriteErrors(
          svc.addArtistToAlbum(
            params.albumId,
            params.artistId,
            omitUndefined({ role: payload.role, displayOrder: payload.displayOrder }),
            write,
          ),
        )
      }),
    )
    .handle('removeArtistFromAlbum', ({ params, headers }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        const svc = yield* MusicEntityService

        const write = yield* musicReferenceHeaderWriteRequest(headers, {
          entityType: 'artist',
          entityId: params.artistId,
        })

        yield* mapMusicWriteErrors(
          svc.removeArtistFromAlbum(params.albumId, params.artistId, write),
        )
      }),
    )
    .handle('addArtistToTrack', ({ params, payload }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        const svc = yield* MusicEntityService
        const write = yield* musicBodyWriteRequest(payload)
        yield* mapMusicWriteErrors(
          svc.addArtistToTrack(
            params.trackId,
            params.artistId,
            omitUndefined({ role: payload.role, displayOrder: payload.displayOrder }),
            write,
          ),
        )
      }),
    )
    .handle('removeArtistFromTrack', ({ params, headers }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        const svc = yield* MusicEntityService

        const write = yield* musicReferenceHeaderWriteRequest(headers, {
          entityType: 'artist',
          entityId: params.artistId,
        })

        yield* mapMusicWriteErrors(
          svc.removeArtistFromTrack(params.trackId, params.artistId, write),
        )
      }),
    )
    // -----------------------------------------------------------------
    // Albums
    // -----------------------------------------------------------------
    .handle('listAlbums', () =>
      Effect.gen(function* () {
        const svc = yield* MusicEntityService
        const rows = yield* dieOnDatabaseError(svc.getAlbums)

        return rows.map(toAlbumResponse)
      }),
    )
    .handle('createAlbum', ({ payload }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        const { user } = yield* AuthSession
        const svc = yield* MusicEntityService

        const row = yield* dieOnDatabaseError(
          svc.createAlbum({ ...toAlbumCreateFields(payload), createdById: user.id }),
        )

        return toAlbumResponse(row)
      }),
    )
    .handle('getAlbum', ({ params }) =>
      Effect.gen(function* () {
        const svc = yield* MusicEntityService

        const row = yield* dieOnDatabaseError(
          svc
            .getAlbumById(params.id)
            .pipe(Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound())),
        )

        return toAlbumResponse(row)
      }),
    )
    .handle('updateAlbum', ({ params, payload }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        const svc = yield* MusicEntityService
        const write = yield* musicBodyWriteRequest(payload)

        const row = yield* mapMusicWriteErrors(
          svc.updateAlbum(params.id, toAlbumUpdateFields(payload), write),
        )

        return toAlbumResponse(row)
      }),
    )
    .handle('deleteAlbum', ({ params, headers }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        const svc = yield* MusicEntityService
        const write = yield* musicHeaderWriteRequest(headers)
        yield* mapMusicWriteErrors(svc.deleteAlbum(params.id, write))
      }),
    )
    .handle('listAlbumLabels', ({ params }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        const svc = yield* MusicEntityService
        const rows = yield* dieOnDatabaseError(svc.getLabelsForAlbum(params.albumId))

        return rows.map(toLabelResponse)
      }),
    )
    // -----------------------------------------------------------------
    // Tracks
    // -----------------------------------------------------------------
    .handle('listTracks', () =>
      Effect.gen(function* () {
        const svc = yield* MusicEntityService
        const rows = yield* dieOnDatabaseError(svc.getTracks)

        return rows.map(toTrackResponse)
      }),
    )
    .handle('createTrack', ({ payload }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        const { user } = yield* AuthSession
        const svc = yield* MusicEntityService

        const row = yield* dieOnDatabaseError(
          svc.createTrack({ ...toTrackCreateFields(payload), createdById: user.id }),
        )

        return toTrackResponse(row)
      }),
    )
    .handle('getTrack', ({ params }) =>
      Effect.gen(function* () {
        const svc = yield* MusicEntityService

        const row = yield* dieOnDatabaseError(
          svc
            .getTrackById(params.id)
            .pipe(Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound())),
        )

        return toTrackResponse(row)
      }),
    )
    .handle('updateTrack', ({ params, payload }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        const svc = yield* MusicEntityService
        const write = yield* musicBodyWriteRequest(payload)

        const row = yield* mapMusicWriteErrors(
          svc.updateTrack(params.id, toTrackUpdateFields(payload), write),
        )

        return toTrackResponse(row)
      }),
    )
    .handle('deleteTrack', ({ params, headers }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        const svc = yield* MusicEntityService
        const write = yield* musicHeaderWriteRequest(headers)
        yield* mapMusicWriteErrors(svc.deleteTrack(params.id, write))
      }),
    )
    // -----------------------------------------------------------------
    // Playlists
    // -----------------------------------------------------------------
    .handle('listPlaylists', () =>
      Effect.gen(function* () {
        const reader = yield* resolvePageSession()
        const rows = yield* dieOnDatabaseError(getReadablePlaylistsEffect(reader ?? undefined))

        return rows.map(toPlaylistResponse)
      }),
    )
    .handle('createPlaylist', ({ payload }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        const { user } = yield* AuthSession
        const svc = yield* MusicEntityService

        const row = yield* dieOnDatabaseError(
          svc.createPlaylist({ ...toPlaylistCreateFields(payload), createdById: user.id }),
        )

        return toPlaylistResponse(row)
      }),
    )
    .handle('getPlaylist', ({ params }) =>
      Effect.gen(function* () {
        const reader = yield* resolvePageSession()

        const row = yield* dieOnDatabaseError(
          getReadablePlaylistByIdEffect(params.id, reader ?? undefined).pipe(
            Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound()),
          ),
        )

        return toPlaylistResponse(row)
      }),
    )
    .handle('updatePlaylist', ({ params, payload }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        const svc = yield* MusicEntityService

        const row = yield* dieOnDatabaseError(
          svc
            .updatePlaylist(params.id, toPlaylistUpdateFields(payload))
            .pipe(Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound())),
        )

        return toPlaylistResponse(row)
      }),
    )
    .handle('deletePlaylist', ({ params }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        const svc = yield* MusicEntityService
        yield* dieOnDatabaseError(
          svc
            .deletePlaylist(params.id)
            .pipe(Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound())),
        )
      }),
    )
    .handle('listLabels', () =>
      Effect.gen(function* () {
        const svc = yield* MusicEntityService
        const rows = yield* dieOnDatabaseError(svc.getLabels(false))

        return rows.map(toLabelResponse)
      }),
    )
    .handle('listLabelsForAdmin', () =>
      Effect.gen(function* () {
        yield* requireAdmin
        const svc = yield* MusicEntityService
        const rows = yield* dieOnDatabaseError(svc.getLabels(true))

        return rows.map(toLabelResponse)
      }),
    )
    .handle('createLabel', ({ payload }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        const { user } = yield* AuthSession
        const svc = yield* MusicEntityService

        const row = yield* dieOnDatabaseError(
          svc
            .createLabel({ ...toLabelCreateFields(payload), createdById: user.id })
            .pipe(Effect.catchTag('ValidationError', () => new ValidationHttpError())),
        )

        return toLabelResponse(row)
      }),
    )
    .handle('getLabelBySlug', ({ params }) =>
      Effect.gen(function* () {
        const svc = yield* MusicEntityService

        const row = yield* dieOnDatabaseError(
          svc
            .getLabelBySlug(params.slug)
            .pipe(Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound())),
        )

        const [artists, albums] = yield* dieOnDatabaseError(
          Effect.all([
            svc.getPublishedArtistsForLabel(row.id),
            svc.getPublishedAlbumsForLabel(row.id),
          ]),
        )

        return {
          ...toLabelResponse(row),
          affiliatedArtists: artists.map(toArtistResponse),
          affiliatedAlbums: albums.map(toAlbumResponse),
        }
      }),
    )
    .handle('getLabel', ({ params }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        const svc = yield* MusicEntityService

        const row = yield* dieOnDatabaseError(
          svc
            .getLabelById(params.id)
            .pipe(Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound())),
        )

        return toLabelResponse(row)
      }),
    )
    .handle('updateLabel', ({ params, payload }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        const svc = yield* MusicEntityService
        const write = yield* musicBodyWriteRequest(payload)

        const row = yield* mapMusicWriteErrors(
          svc.updateLabel(params.id, toLabelUpdateFields(payload), write),
        )

        return toLabelResponse(row)
      }),
    )
    .handle('deleteLabel', ({ params, headers }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        const svc = yield* MusicEntityService
        const write = yield* musicHeaderWriteRequest(headers)
        yield* mapMusicWriteErrors(svc.deleteLabel(params.id, write))
      }),
    )
    .handle('listLabelArtists', ({ params }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        const svc = yield* MusicEntityService
        const rows = yield* dieOnDatabaseError(svc.getArtistsForLabel(params.labelId))

        return rows.map(toArtistResponse)
      }),
    )
    .handle('listLabelAlbums', ({ params }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        const svc = yield* MusicEntityService
        const rows = yield* dieOnDatabaseError(svc.getAlbumsForLabel(params.labelId))

        return rows.map(toAlbumResponse)
      }),
    )
    .handle('affiliateArtistWithLabel', ({ params, headers }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        const svc = yield* MusicEntityService

        const write = yield* musicReferenceHeaderWriteRequest(headers, {
          entityType: 'label',
          entityId: params.labelId,
        })

        yield* mapMusicWriteErrors(
          svc.affiliateArtistWithLabel(params.labelId, params.artistId, write),
        )
      }),
    )
    .handle('unaffiliateArtistFromLabel', ({ params, headers }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        const svc = yield* MusicEntityService

        const write = yield* musicReferenceHeaderWriteRequest(headers, {
          entityType: 'label',
          entityId: params.labelId,
        })

        yield* mapMusicWriteErrors(
          svc.unaffiliateArtistFromLabel(params.labelId, params.artistId, write),
        )
      }),
    )
    .handle('affiliateAlbumWithLabel', ({ params, headers }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        const svc = yield* MusicEntityService

        const write = yield* musicReferenceHeaderWriteRequest(headers, {
          entityType: 'label',
          entityId: params.labelId,
        })

        yield* mapMusicWriteErrors(
          svc.affiliateAlbumWithLabel(params.labelId, params.albumId, write),
        )
      }),
    )
    .handle('unaffiliateAlbumFromLabel', ({ params, headers }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        const svc = yield* MusicEntityService

        const write = yield* musicReferenceHeaderWriteRequest(headers, {
          entityType: 'label',
          entityId: params.labelId,
        })

        yield* mapMusicWriteErrors(
          svc.unaffiliateAlbumFromLabel(params.labelId, params.albumId, write),
        )
      }),
    )
    // -----------------------------------------------------------------
    // Playlist tracks
    // -----------------------------------------------------------------
    .handle('getPlaylistTracks', ({ params }) =>
      Effect.gen(function* () {
        const svc = yield* MusicEntityService
        const reader = yield* resolvePageSession()
        yield* dieOnDatabaseError(
          getReadablePlaylistByIdEffect(params.id, reader ?? undefined).pipe(
            Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound()),
          ),
        )
        const rows = yield* dieOnDatabaseError(svc.getPlaylistTracks(params.id))

        return rows.map((entry) => ({
          track: toTrackResponse(entry.track),
          position: entry.position,
          addedAt: entry.addedAt.toISOString(),
          links: entry.links.map(toEntityLinkResponse),
        }))
      }),
    )
    .handle('addTrackToPlaylist', ({ params, payload }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        const svc = yield* MusicEntityService

        const row = yield* dieOnDatabaseError(
          svc.addTrackToPlaylist(params.id, payload.trackId, payload.position),
        )

        return {
          playlistId: row.playlistId,
          trackId: row.trackId,
          position: row.position,
          addedAt: row.addedAt.toISOString(),
        }
      }),
    )
    .handle('removeTrackFromPlaylist', ({ params }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        const svc = yield* MusicEntityService
        yield* dieOnDatabaseError(svc.removeTrackFromPlaylist(params.id, params.trackId))
      }),
    )
    .handle('reorderPlaylistTracks', ({ params, payload }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        const svc = yield* MusicEntityService
        yield* svc
          .reorderPlaylistTracks(params.id, [...payload.trackIds])
          .pipe(
            Effect.catchTag('DatabaseError', (cause) =>
              cause.message.includes('match current playlist tracks')
                ? new HttpApiError.BadRequest()
                : Effect.die(cause),
            ),
          )
      }),
    )
    .handle('addSpotifyTrackToPlaylist', ({ params, payload }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        const svc = yield* MusicEntityService

        const result = yield* mapSpotifyTrackImportErrors(
          mapMusicIdentityErrors(svc.addSpotifyTrackToPlaylist(params.id, payload.url)),
        ).pipe(dieOnDatabaseError)

        return result
      }),
    )
    .handle('importSpotifyPlaylist', ({ payload }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        const { user } = yield* AuthSession
        const svc = yield* MusicEntityService
        const queue = yield* PlaylistEnrichmentQueue

        const spotifyPlaylistId = getIdFromSpotifyUrl(payload.url)

        if (!spotifyPlaylistId) {
          return yield* new HttpApiError.BadRequest()
        }

        const result = yield* mapSpotifyTrackImportErrors(
          mapMusicIdentityErrors(svc.importSpotifyPlaylist(payload.url, user.id)),
        ).pipe(dieOnDatabaseError)

        const enrichmentStatus = yield* queue
          .enqueue(
            PlaylistEnrichmentJob.make({
              playlistId: result.playlist.id,
              reason: 'after_import',
            }),
          )
          .pipe(
            Effect.as('Accepted' as const),
            Effect.catchTag('PlaylistEnrichmentQueueUnavailable', () =>
              Effect.logWarning('[music] Playlist imported without accepted enrichment', {
                playlistId: result.playlist.id,
              }).pipe(Effect.as('Unavailable' as const)),
            ),
          )

        return {
          status: 'Imported' as const,
          playlistId: result.playlist.id,
          trackCount: result.trackCount,
          createdTrackCount: result.createdTrackCount,
          reusedTrackCount: result.reusedTrackCount,
          enrichmentStatus,
        }
      }),
    )
    .handle('syncPlaylistLinks', ({ params }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        const svc = yield* MusicEntityService
        const queue = yield* PlaylistEnrichmentQueue
        yield* dieOnDatabaseError(
          svc
            .getPlaylistById(params.id)
            .pipe(Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound())),
        )
        yield* enqueuePlaylistJob(
          queue.enqueue(
            PlaylistEnrichmentJob.make({
              playlistId: params.id,
              reason: 'manual',
            }),
          ),
        )

        return { playlistId: params.id, status: 'Accepted' as const }
      }),
    )
    // -----------------------------------------------------------------
    // Resolve a pasted URL into a music entity
    // -----------------------------------------------------------------
    .handle('resolveMusicEntity', ({ payload }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        const identity = yield* CanonicalMusicIdentity

        const result = yield* mapMusicIdentityErrors(
          identity.resolveSource({
            url: payload.url,
            origin: payload.origin ?? 'editorial',
            artworkDelivery: 'required',
          }),
        )

        return toResolvedMusicEntityResponse(result)
      }),
    )
    // -----------------------------------------------------------------
    // Links
    // -----------------------------------------------------------------
    .handle('listEntityLinks', ({ params, query }) =>
      Effect.gen(function* () {
        const svc = yield* MusicEntityService

        const rows = yield* dieOnDatabaseError(
          svc.getLinksForEntity(params.entityType, params.entityId, query.status),
        )

        return rows.map(toEntityLinkResponse)
      }),
    )
    .handle('addEntityLink', ({ params, payload }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        const svc = yield* MusicEntityService

        const row = yield* dieOnDatabaseError(
          mapMusicIdentityErrors(
            svc.addLink({
              entityType: params.entityType,
              entityId: params.entityId,
              platform: payload.platform,
              url: payload.url,
              status: payload.status,
            }),
          ).pipe(Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound())),
        )

        return toEntityLinkResponse(row)
      }),
    )
    .handle('updateEntityLinkStatus', ({ params, payload }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        const { user } = yield* AuthSession
        const userId = payload.status === 'verified' ? user.id : undefined
        const svc = yield* MusicEntityService

        const row = yield* dieOnDatabaseError(
          mapMusicIdentityErrors(
            svc.updateLinkStatus(
              params.entityType,
              params.entityId,
              params.linkId,
              payload.status,
              userId,
              payload.metadata == null ? undefined : decodeMusicEntityMetadata(payload.metadata),
            ),
          ).pipe(Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound())),
        )

        return toEntityLinkResponse(row)
      }),
    )
    .handle('deleteEntityLink', ({ params }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        const svc = yield* MusicEntityService
        yield* dieOnDatabaseError(
          mapMusicIdentityErrors(
            svc.deleteLink(params.entityType, params.entityId, params.linkId),
          ).pipe(Effect.catchTag('NotFoundError', () => new HttpApiError.NotFound())),
        )
      }),
    )
    .handle('rescrapeEntityLinks', ({ params }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        const { user } = yield* AuthSession
        const identity = yield* CanonicalMusicIdentity

        const result = yield* mapMusicIdentityErrors(
          identity.refreshEntity({
            entityType: params.entityType,
            entityId: params.entityId,
            actorId: user.id,
            origin: 'manual',
            artworkDelivery: 'preserve',
          }),
        )

        return { links: result.links.map(toEntityLinkResponse) }
      }),
    )
    // -----------------------------------------------------------------
    // Scrape
    // -----------------------------------------------------------------
    .handle('scrapeEntityLinks', ({ params, payload }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        // Every field is optional, but at least one real lookup key is
        // required -- an all-empty payload would otherwise reach the
        // scraper with nothing to search on and insert a placeholder
        // ("Untitled Album" etc) row. The old Hono route's docstring said
        // "provide at least one field" but never actually enforced it;
        // enforcing it here rather than carrying the gap forward.
        const hasAnyField = Object.values(payload).some((value) => value !== undefined)

        if (!hasAnyField) {
          return yield* new HttpApiError.BadRequest()
        }

        const svc = yield* MusicEntityService
        const identity = yield* CanonicalMusicIdentity

        const result = payload.url
          ? yield* mapMusicIdentityErrors(
              identity.resolveSource({
                url: payload.url,
                expectedType: params.entityType,
                origin: 'manual',
                artworkDelivery: 'preserve',
              }),
            )
          : yield* dieOnDatabaseError(
              svc
                .scrapeAndCreateEntityWithoutSource(params.entityType, omitUndefined(payload))
                .pipe(
                  Effect.catchTag('ValidationError', () =>
                    Effect.fail(new HttpApiError.BadRequest()),
                  ),
                  Effect.catchTag('MusicScraperError', (error) =>
                    Effect.gen(function* () {
                      if (error.statusCode === 400 || error.statusCode === 404) {
                        return yield* new HttpApiError.BadRequest()
                      }

                      return yield* new MusicServiceUnavailableResponse({
                        retryAfterSeconds: PROVIDER_UNAVAILABLE_RETRY_AFTER_SECONDS,
                      })
                    }),
                  ),
                ),
            )

        return {
          entity: toScrapeMusicEntityResponse(result),
          links: result.links.map(toEntityLinkResponse),
        }
      }),
    ),
)
