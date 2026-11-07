import { LINK_STATUS, type LinkStatus } from '@gbfm/core/status'
import { Context, Effect, Layer } from 'effect'

import { Database } from '@/db/layer'
import type {
  InsertMusicEntityLink,
  MusicEntityType,
  SelectMusicAlbum,
  SelectMusicArtist,
  SelectMusicEntityLink,
  SelectMdxCompiledMusicLabel,
  SelectMusicLabel,
  SelectMusicPlaylist,
  SelectMusicPlaylistTrack,
  SelectMusicTrack,
} from '@/db/music-entity.schema'
import { type DatabaseError, NotFoundError, type ValidationError } from '@/errors'
import { MdxService } from '@/lib/mdx'
import { omitUndefined } from '@/lib/omit-undefined'
import {
  CanonicalMusicIdentity,
  type MusicIdentityError,
} from '@/services/canonical-music-identity'
import { parseMusicSource } from '@/services/canonical-music-identity/music-source'
import {
  MusicLinkScraperService as MusicLinkScraperServiceTag,
  type MusicScraperError,
} from '@/services/music-link-scraper.service'
import {
  SpotifyService as SpotifyServiceTag,
  type SpotifyServiceError,
} from '@/services/spotify.service'

import {
  addArtistToAlbumEffect,
  type CreateAlbumInput,
  createAlbumEffect,
  deleteAlbumEffect,
  getAlbumByIdEffect,
  getAlbumsEffect,
  removeArtistFromAlbumEffect,
  updateAlbumEffect,
} from './album.service'
import {
  type CreateArtistInput,
  createArtistEffect,
  deleteArtistEffect,
  getArtistByIdEffect,
  getArtistsEffect,
  updateArtistEffect,
} from './artist.service'
import {
  affiliateAlbumWithLabelEffect,
  affiliateArtistWithLabelEffect,
  getAlbumsForLabelEffect,
  getArtistsForLabelEffect,
  getLabelsForAlbumEffect,
  getLabelsForArtistEffect,
  getPublishedAlbumsForLabelEffect,
  getPublishedArtistsForLabelEffect,
  unaffiliateAlbumFromLabelEffect,
  unaffiliateArtistFromLabelEffect,
} from './label-affiliation.service'
import {
  type CreateLabelInput,
  createLabelEffect,
  deleteLabelEffect,
  getLabelByIdEffect,
  getLabelBySlugEffect,
  getLabelsEffect,
  updateLabelEffect,
} from './label.service'
import {
  addLinkEffect,
  deleteLinkEffect,
  getLinksForEntityEffect,
  updateLinkStatusEffect,
} from './link.service'
import {
  addSpotifyTrackToPlaylistEffect,
  addTrackToPlaylistEffect,
  getPlaylistTracksEffect,
  enrichPlaylistLinksEffect,
  importSpotifyPlaylistEffect,
  removeTrackFromPlaylistEffect,
  reorderPlaylistTracksEffect,
  syncPlaylistLinksEffect,
} from './playlist-tracks.service'
import {
  type CreatePlaylistInput,
  createPlaylistEffect,
  deletePlaylistEffect,
  getPlaylistByIdEffect,
  getPlaylistsEffect,
  updatePlaylistEffect,
} from './playlist.service'
import {
  type MusicMetadataScrapeInput,
  scrapeAndCreateEntityWithoutSourceEffect,
  type ScrapedMusicEntity,
} from './scrape.service'
import {
  addArtistToTrackEffect,
  type CreateTrackInput,
  createTrackEffect,
  deleteTrackEffect,
  getTrackByIdEffect,
  getTracksEffect,
  removeArtistFromTrackEffect,
  updateTrackEffect,
} from './track.service'
import type { MusicWriteError, MusicWriteRequest } from './write-intent'

export type {
  CreateAlbumInput,
  CreateArtistInput,
  CreateLabelInput,
  CreatePlaylistInput,
  CreateTrackInput,
  ScrapedMusicEntity,
}

type ScrapeableMusicEntityType = Exclude<MusicEntityType, 'label'>

const isLegacyDirectLink = (entityType: ScrapeableMusicEntityType, platform: string, url: string) =>
  parseMusicSource(url).pipe(
    Effect.map(
      (source) =>
        entityType === 'album' &&
        source.platform === 'youtube' &&
        source.sourceEntityType === 'video' &&
        (platform === 'youtube' || platform === 'youtube_music'),
    ),
  )

const preserveCanonicalMetadata = (
  link: SelectMusicEntityLink | undefined,
  metadata: InsertMusicEntityLink['metadata'],
): InsertMusicEntityLink['metadata'] =>
  link && metadata ? { ...metadata, ...link.metadata } : metadata

export interface MusicEntityService {
  readonly createArtist: (
    data: CreateArtistInput,
  ) => Effect.Effect<SelectMusicArtist, DatabaseError>
  readonly getArtists: Effect.Effect<Array<SelectMusicArtist>, DatabaseError>
  readonly getArtistById: (
    id: string,
  ) => Effect.Effect<SelectMusicArtist, DatabaseError | NotFoundError>
  readonly updateArtist: (
    id: string,
    data: Partial<CreateArtistInput>,
    write?: MusicWriteRequest,
  ) => Effect.Effect<SelectMusicArtist, MusicWriteError>
  readonly deleteArtist: (
    id: string,
    write?: MusicWriteRequest,
  ) => Effect.Effect<void, MusicWriteError>

  readonly createAlbum: (data: CreateAlbumInput) => Effect.Effect<SelectMusicAlbum, DatabaseError>
  readonly getAlbums: Effect.Effect<Array<SelectMusicAlbum>, DatabaseError>
  readonly getAlbumById: (
    id: string,
  ) => Effect.Effect<SelectMusicAlbum, DatabaseError | NotFoundError>
  readonly updateAlbum: (
    id: string,
    data: Partial<CreateAlbumInput>,
  ) => Effect.Effect<SelectMusicAlbum, DatabaseError | NotFoundError>
  readonly deleteAlbum: (
    id: string,
    write?: MusicWriteRequest,
  ) => Effect.Effect<void, MusicWriteError>

  readonly createTrack: (data: CreateTrackInput) => Effect.Effect<SelectMusicTrack, DatabaseError>
  readonly getTracks: Effect.Effect<Array<SelectMusicTrack>, DatabaseError>
  readonly getTrackById: (
    id: string,
  ) => Effect.Effect<SelectMusicTrack, DatabaseError | NotFoundError>
  readonly updateTrack: (
    id: string,
    data: Partial<CreateTrackInput>,
  ) => Effect.Effect<SelectMusicTrack, DatabaseError | NotFoundError>
  readonly deleteTrack: (
    id: string,
    write?: MusicWriteRequest,
  ) => Effect.Effect<void, MusicWriteError>

  readonly createPlaylist: (
    data: CreatePlaylistInput,
  ) => Effect.Effect<SelectMusicPlaylist, DatabaseError>
  readonly getPlaylists: Effect.Effect<
    Array<SelectMusicPlaylist & { spotifyUrl: string | null }>,
    DatabaseError
  >
  readonly getPlaylistById: (
    id: string,
  ) => Effect.Effect<
    SelectMusicPlaylist & { spotifyUrl: string | null },
    DatabaseError | NotFoundError
  >
  readonly updatePlaylist: (
    id: string,
    data: Partial<CreatePlaylistInput>,
  ) => Effect.Effect<SelectMusicPlaylist, DatabaseError | NotFoundError>
  readonly deletePlaylist: (id: string) => Effect.Effect<void, DatabaseError | NotFoundError>

  readonly createLabel: (
    data: CreateLabelInput,
  ) => Effect.Effect<SelectMusicLabel, DatabaseError | ValidationError>
  readonly getLabels: (
    includeDrafts: boolean,
  ) => Effect.Effect<Array<SelectMusicLabel>, DatabaseError>
  readonly getLabelById: (
    id: string,
  ) => Effect.Effect<SelectMusicLabel, DatabaseError | NotFoundError>
  readonly getLabelBySlug: (
    slug: string,
  ) => Effect.Effect<SelectMdxCompiledMusicLabel, DatabaseError | NotFoundError>
  readonly updateLabel: (
    id: string,
    data: Partial<CreateLabelInput>,
  ) => Effect.Effect<SelectMusicLabel, DatabaseError | NotFoundError | ValidationError>
  readonly deleteLabel: (
    id: string,
    write?: MusicWriteRequest,
  ) => Effect.Effect<void, MusicWriteError>

  readonly getArtistsForLabel: (
    labelId: string,
  ) => Effect.Effect<Array<SelectMusicArtist>, DatabaseError>
  readonly getPublishedArtistsForLabel: (
    labelId: string,
  ) => Effect.Effect<Array<SelectMusicArtist>, DatabaseError>
  readonly getAlbumsForLabel: (
    labelId: string,
  ) => Effect.Effect<Array<SelectMusicAlbum>, DatabaseError>
  readonly getPublishedAlbumsForLabel: (
    labelId: string,
  ) => Effect.Effect<Array<SelectMusicAlbum>, DatabaseError>
  readonly getLabelsForArtist: (
    artistId: string,
  ) => Effect.Effect<Array<SelectMusicLabel>, DatabaseError>
  readonly getLabelsForAlbum: (
    albumId: string,
  ) => Effect.Effect<Array<SelectMusicLabel>, DatabaseError>
  readonly affiliateArtistWithLabel: (
    labelId: string,
    artistId: string,
  ) => Effect.Effect<void, DatabaseError | NotFoundError>
  readonly unaffiliateArtistFromLabel: (
    labelId: string,
    artistId: string,
  ) => Effect.Effect<void, DatabaseError>
  readonly affiliateAlbumWithLabel: (
    labelId: string,
    albumId: string,
  ) => Effect.Effect<void, DatabaseError | NotFoundError>
  readonly unaffiliateAlbumFromLabel: (
    labelId: string,
    albumId: string,
  ) => Effect.Effect<void, DatabaseError>

  readonly getPlaylistTracks: (playlistId: string) => Effect.Effect<
    Array<{
      track: SelectMusicTrack
      position: number
      addedAt: Date
      links: Array<SelectMusicEntityLink>
    }>,
    DatabaseError
  >
  readonly addTrackToPlaylist: (
    playlistId: string,
    trackId: string,
    position: number,
  ) => Effect.Effect<SelectMusicPlaylistTrack, DatabaseError>
  readonly removeTrackFromPlaylist: (
    playlistId: string,
    trackId: string,
  ) => Effect.Effect<void, DatabaseError>
  readonly reorderPlaylistTracks: (
    playlistId: string,
    trackIds: Array<string>,
  ) => Effect.Effect<void, DatabaseError>
  readonly addSpotifyTrackToPlaylist: (
    playlistId: string,
    spotifyUrl: string,
  ) => Effect.Effect<
    { trackId: string; position: number; created: boolean },
    DatabaseError | SpotifyServiceError | MusicIdentityError
  >
  readonly importSpotifyPlaylist: (
    url: string,
    curatorId?: string | null,
  ) => Effect.Effect<
    {
      playlist: SelectMusicPlaylist
      trackCount: number
      createdTrackCount: number
      reusedTrackCount: number
    },
    DatabaseError | SpotifyServiceError | MusicIdentityError
  >
  readonly syncPlaylistLinks: (
    playlistId: string,
  ) => Effect.Effect<
    { playlistId: string; trackCount: number; insertedCount: number },
    DatabaseError | SpotifyServiceError | MusicIdentityError
  >
  readonly enrichPlaylistLinks: (
    playlistId: string,
  ) => Effect.Effect<
    { playlistId: string; trackCount: number; insertedCount: number },
    DatabaseError | MusicIdentityError
  >

  readonly addArtistToAlbum: (
    albumId: string,
    artistId: string,
    opts?: { role?: string; displayOrder?: number },
  ) => Effect.Effect<void, DatabaseError>
  readonly removeArtistFromAlbum: (
    albumId: string,
    artistId: string,
  ) => Effect.Effect<void, DatabaseError>
  readonly addArtistToTrack: (
    trackId: string,
    artistId: string,
    opts?: { role?: string; displayOrder?: number },
  ) => Effect.Effect<void, DatabaseError>
  readonly removeArtistFromTrack: (
    trackId: string,
    artistId: string,
  ) => Effect.Effect<void, DatabaseError>

  readonly getLinksForEntity: (
    entityType: MusicEntityType,
    entityId: string,
    statusFilter?: LinkStatus,
  ) => Effect.Effect<Array<SelectMusicEntityLink>, DatabaseError>
  readonly addLink: (
    data: InsertMusicEntityLink,
  ) => Effect.Effect<SelectMusicEntityLink, DatabaseError | NotFoundError | MusicIdentityError>
  readonly updateLinkStatus: (
    entityType: MusicEntityType,
    entityId: string,
    linkId: string,
    status: LinkStatus,
    verifiedBy?: string,
    metadata?: InsertMusicEntityLink['metadata'],
  ) => Effect.Effect<SelectMusicEntityLink, DatabaseError | NotFoundError | MusicIdentityError>
  readonly deleteLink: (
    entityType: MusicEntityType,
    entityId: string,
    linkId: string,
  ) => Effect.Effect<void, DatabaseError | NotFoundError | MusicIdentityError>

  readonly scrapeAndCreateEntityWithoutSource: (
    entityType: ScrapeableMusicEntityType,
    input: MusicMetadataScrapeInput,
  ) => Effect.Effect<ScrapedMusicEntity, DatabaseError | MusicScraperError | ValidationError>
}

export const MusicEntityService = Context.Service<MusicEntityService>('MusicEntityService')

export const MusicEntityServiceLayer = Layer.effect(
  MusicEntityService,
  Effect.gen(function* () {
    const scraper = yield* MusicLinkScraperServiceTag
    const spotify = yield* SpotifyServiceTag
    const identity = yield* CanonicalMusicIdentity
    const db = yield* Database
    const mdx = yield* MdxService
    const provideDb = Effect.provideService(Database, db)

    const releaseIdentityLink = (
      entityType: ScrapeableMusicEntityType,
      entityId: string,
      linkId: string,
      action: 'reject' | 'delete',
      verifiedBy?: string,
      metadata?: InsertMusicEntityLink['metadata'],
    ) =>
      identity
        .releaseLink(omitUndefined({ entityType, entityId, linkId, action, verifiedBy, metadata }))
        .pipe(
          Effect.catchTags({
            MusicIdentityEntityNotFound: () =>
              Effect.fail(new NotFoundError({ message: 'Music entity not found', id: entityId })),
            MusicIdentitySourceLinkNotFound: () =>
              Effect.fail(
                new NotFoundError({ message: 'Music entity link not found', id: linkId }),
              ),
          }),
        )

    const verifyIdentityLink = (
      entityType: ScrapeableMusicEntityType,
      entityId: string,
      linkId: string,
      verifiedBy?: string,
      metadata?: InsertMusicEntityLink['metadata'],
    ) =>
      provideDb(getLinksForEntityEffect(entityType, entityId)).pipe(
        Effect.flatMap((links) => {
          const link = links.find((candidate) => candidate.id === linkId)

          return link
            ? Effect.succeed(link)
            : Effect.fail(new NotFoundError({ message: 'Music entity link not found', id: linkId }))
        }),
        Effect.flatMap((link) =>
          identity
            .attachLink({
              entityType,
              entityId,
              platform: link.platform,
              url: link.url,
              origin: 'manual',
            })
            .pipe(
              Effect.catchTag('MusicSourceInvalid', (error) =>
                Effect.gen(function* () {
                  if (error.reason !== 'type_mismatch') return yield* error
                  const direct = yield* isLegacyDirectLink(entityType, link.platform, link.url)

                  if (!direct) return yield* error

                  return undefined
                }),
              ),
            ),
        ),
        Effect.flatMap((identityLink) =>
          provideDb(
            updateLinkStatusEffect(
              entityType,
              entityId,
              linkId,
              LINK_STATUS.VERIFIED,
              verifiedBy,
              preserveCanonicalMetadata(identityLink, metadata),
            ),
          ),
        ),
      )

    const attachIdentityLink = (
      data: InsertMusicEntityLink,
      entityType: ScrapeableMusicEntityType,
    ) =>
      Effect.gen(function* () {
        const link = yield* identity.attachLink({
          entityType,
          entityId: data.entityId,
          platform: data.platform,
          url: data.url,
          origin: 'manual',
        })

        if (data.status === LINK_STATUS.REJECTED) {
          const released = yield* releaseIdentityLink(
            entityType,
            data.entityId,
            link.id,
            'reject',
            undefined,
            data.metadata,
          )

          if (!released) return yield* Effect.die('Rejected link was not returned')

          return released
        }

        if (data.status !== undefined || data.metadata !== undefined) {
          return yield* provideDb(
            updateLinkStatusEffect(
              entityType,
              data.entityId,
              link.id,
              LINK_STATUS.VERIFIED,
              undefined,
              preserveCanonicalMetadata(link, data.metadata),
            ),
          )
        }

        return link
      }).pipe(
        Effect.catchTag('MusicSourceInvalid', (error) =>
          Effect.gen(function* () {
            if (error.reason !== 'type_mismatch') return yield* error
            const direct = yield* isLegacyDirectLink(entityType, data.platform, data.url)

            if (!direct) return yield* error

            return yield* provideDb(addLinkEffect(data))
          }),
        ),
      )

    return {
      createArtist: (data) => provideDb(createArtistEffect(data)),
      getArtists: provideDb(getArtistsEffect),
      getArtistById: (id) => provideDb(getArtistByIdEffect(id)),
      updateArtist: (id, data, write) => provideDb(updateArtistEffect(id, data, write)),
      deleteArtist: (id, write) => provideDb(deleteArtistEffect(id, write)),

      createAlbum: (data) => provideDb(createAlbumEffect(data)),
      getAlbums: provideDb(getAlbumsEffect),
      getAlbumById: (id) => provideDb(getAlbumByIdEffect(id)),
      updateAlbum: (id, data) => provideDb(updateAlbumEffect(id, data)),
      deleteAlbum: (id, write) => provideDb(deleteAlbumEffect(id, write)),

      createTrack: (data) => provideDb(createTrackEffect(data)),
      getTracks: provideDb(getTracksEffect),
      getTrackById: (id) => provideDb(getTrackByIdEffect(id)),
      updateTrack: (id, data) => provideDb(updateTrackEffect(id, data)),
      deleteTrack: (id, write) => provideDb(deleteTrackEffect(id, write)),

      createPlaylist: (data) => provideDb(createPlaylistEffect(data)),
      getPlaylists: provideDb(getPlaylistsEffect),
      getPlaylistById: (id) => provideDb(getPlaylistByIdEffect(id)),
      updatePlaylist: (id, data) => provideDb(updatePlaylistEffect(id, data)),
      deletePlaylist: (id) => provideDb(deletePlaylistEffect(id)),

      createLabel: (data) => provideDb(createLabelEffect(data)),
      getLabels: (includeDrafts) => provideDb(getLabelsEffect(includeDrafts)),
      getLabelById: (id) => provideDb(getLabelByIdEffect(id)),
      getLabelBySlug: (slug) =>
        provideDb(getLabelBySlugEffect(slug).pipe(Effect.provideService(MdxService, mdx))),
      updateLabel: (id, data) => provideDb(updateLabelEffect(id, data)),
      deleteLabel: (id, write) => provideDb(deleteLabelEffect(id, write)),

      getArtistsForLabel: (labelId) => provideDb(getArtistsForLabelEffect(labelId)),
      getPublishedArtistsForLabel: (labelId) =>
        provideDb(getPublishedArtistsForLabelEffect(labelId)),
      getAlbumsForLabel: (labelId) => provideDb(getAlbumsForLabelEffect(labelId)),
      getPublishedAlbumsForLabel: (labelId) => provideDb(getPublishedAlbumsForLabelEffect(labelId)),
      getLabelsForArtist: (artistId) => provideDb(getLabelsForArtistEffect(artistId)),
      getLabelsForAlbum: (albumId) => provideDb(getLabelsForAlbumEffect(albumId)),
      affiliateArtistWithLabel: (labelId, artistId) =>
        provideDb(affiliateArtistWithLabelEffect(labelId, artistId)),
      unaffiliateArtistFromLabel: (labelId, artistId) =>
        provideDb(unaffiliateArtistFromLabelEffect(labelId, artistId)),
      affiliateAlbumWithLabel: (labelId, albumId) =>
        provideDb(affiliateAlbumWithLabelEffect(labelId, albumId)),
      unaffiliateAlbumFromLabel: (labelId, albumId) =>
        provideDb(unaffiliateAlbumFromLabelEffect(labelId, albumId)),

      getPlaylistTracks: (playlistId) => provideDb(getPlaylistTracksEffect(playlistId)),
      addTrackToPlaylist: (playlistId, trackId, position) =>
        provideDb(addTrackToPlaylistEffect(playlistId, trackId, position)),
      removeTrackFromPlaylist: (playlistId, trackId) =>
        provideDb(removeTrackFromPlaylistEffect(playlistId, trackId)),
      reorderPlaylistTracks: (playlistId, trackIds) =>
        provideDb(reorderPlaylistTracksEffect(playlistId, trackIds)),
      addSpotifyTrackToPlaylist: (playlistId, spotifyUrl) =>
        provideDb(addSpotifyTrackToPlaylistEffect(spotify, identity)(playlistId, spotifyUrl)),
      importSpotifyPlaylist: (url, curatorId) =>
        provideDb(importSpotifyPlaylistEffect(spotify, identity)(url, curatorId)),
      enrichPlaylistLinks: (playlistId) =>
        provideDb(enrichPlaylistLinksEffect(identity)(playlistId)),
      syncPlaylistLinks: (playlistId) => provideDb(syncPlaylistLinksEffect(identity)(playlistId)),

      addArtistToAlbum: (albumId, artistId, opts) =>
        provideDb(addArtistToAlbumEffect(albumId, artistId, opts)),
      removeArtistFromAlbum: (albumId, artistId) =>
        provideDb(removeArtistFromAlbumEffect(albumId, artistId)),
      addArtistToTrack: (trackId, artistId, opts) =>
        provideDb(addArtistToTrackEffect(trackId, artistId, opts)),
      removeArtistFromTrack: (trackId, artistId) =>
        provideDb(removeArtistFromTrackEffect(trackId, artistId)),

      getLinksForEntity: (entityType, entityId, statusFilter) =>
        provideDb(getLinksForEntityEffect(entityType, entityId, statusFilter)),
      addLink: (data) =>
        data.entityType === 'artist' ||
        data.entityType === 'album' ||
        data.entityType === 'track' ||
        data.entityType === 'playlist'
          ? attachIdentityLink(data, data.entityType)
          : provideDb(addLinkEffect(data)),
      updateLinkStatus: (entityType, entityId, linkId, status, verifiedBy, metadata) =>
        entityType !== 'label' && status === LINK_STATUS.REJECTED
          ? releaseIdentityLink(entityType, entityId, linkId, 'reject', verifiedBy, metadata).pipe(
              Effect.flatMap((link) =>
                link
                  ? Effect.succeed(link)
                  : Effect.die('Canonical identity rejected link without returning it'),
              ),
            )
          : entityType !== 'label' && status === LINK_STATUS.VERIFIED
            ? verifyIdentityLink(entityType, entityId, linkId, verifiedBy, metadata)
            : provideDb(
                updateLinkStatusEffect(entityType, entityId, linkId, status, verifiedBy, metadata),
              ),
      deleteLink: (entityType, entityId, linkId) =>
        entityType === 'label'
          ? provideDb(deleteLinkEffect(entityType, entityId, linkId))
          : releaseIdentityLink(entityType, entityId, linkId, 'delete').pipe(Effect.asVoid),
      scrapeAndCreateEntityWithoutSource: (entityType, input) =>
        provideDb(scrapeAndCreateEntityWithoutSourceEffect(scraper, entityType, input)),
    } satisfies MusicEntityService
  }),
)
