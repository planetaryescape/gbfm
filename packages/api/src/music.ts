import { RichContentDocument } from '@gbfm/rich-content/schema'
import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiError, HttpApiGroup, HttpApiSchema } from 'effect/http-api'

import { MusicServiceUnavailableHttpError } from './errors'
import { AuthMiddleware } from './middleware/auth'
import { ValidationHttpError } from './post'

export { MusicServiceUnavailableHttpError, MusicServiceUnavailableResponse } from './errors'

// Mirrors apps/server/src/db/music-entity.schema.ts's selectMusicArtistSchema
// (Zod, DB-facing) -- response fields are nullable to match actual column
// nullability, not because the API wants to encourage nulls.
export const ArtistResponse = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  bio: Schema.NullOr(Schema.String),
  imageUrl: Schema.NullOr(Schema.String),
  genres: Schema.NullOr(Schema.Array(Schema.String)),
  slug: Schema.String,
  publishedAt: Schema.NullOr(Schema.String),
  createdById: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
})

export type ArtistResponse = typeof ArtistResponse.Type

export const ArtistListResponse = Schema.Array(ArtistResponse)

// slug is required on create (mirrors insertMusicArtistSchema) -- the
// service does not derive it here, unlike update. createdById is not part
// of the payload; the handler injects it from AuthSession.
export const CreateArtistInput = Schema.Struct({
  name: Schema.String,
  bio: Schema.optional(Schema.String),
  imageUrl: Schema.optional(Schema.String),
  genres: Schema.optional(Schema.Array(Schema.String)),
  slug: Schema.String,
  publishedAt: Schema.optional(Schema.String),
})

export type CreateArtistInput = typeof CreateArtistInput.Type

// All fields optional (mirrors updateMusicArtistSchema = insert.partial()).
// If name is sent without slug, the handler derives slug from name --
// asymmetric with create, preserved intentionally from the Hono behavior.
export const UpdateArtistInput = Schema.Struct({
  name: Schema.optional(Schema.String),
  bio: Schema.optional(Schema.String),
  imageUrl: Schema.optional(Schema.String),
  genres: Schema.optional(Schema.Array(Schema.String)),
  slug: Schema.optional(Schema.String),
  publishedAt: Schema.optional(Schema.String),
})

export type UpdateArtistInput = typeof UpdateArtistInput.Type

const artistIdParam = { id: Schema.String }

const ArtistJunctionInput = Schema.Struct({
  role: Schema.optional(Schema.String),
  displayOrder: Schema.optional(Schema.Number),
})

// Mirrors apps/server/src/db/music-entity.schema.ts's selectMusicAlbumSchema.
export const AlbumResponse = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  artistNames: Schema.NullOr(Schema.Array(Schema.String)),
  releaseDate: Schema.NullOr(Schema.String),
  coverImageUrl: Schema.NullOr(Schema.String),
  genres: Schema.NullOr(Schema.Array(Schema.String)),
  albumType: Schema.NullOr(Schema.String),
  slug: Schema.String,
  publishedAt: Schema.NullOr(Schema.String),
  createdById: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
})

export type AlbumResponse = typeof AlbumResponse.Type

export const AlbumListResponse = Schema.Array(AlbumResponse)

const NonEmptyString = Schema.String.pipe(Schema.check(Schema.isMinLength(1)))

export const CreateAlbumInput = Schema.Struct({
  title: NonEmptyString,
  artistNames: Schema.optional(Schema.Array(Schema.String)),
  artistIds: Schema.optional(Schema.Array(Schema.String)),
  releaseDate: Schema.optional(Schema.String),
  coverImageUrl: Schema.optional(Schema.String),
  genres: Schema.optional(Schema.Array(Schema.String)),
  albumType: Schema.optional(Schema.String),
  slug: NonEmptyString,
  publishedAt: Schema.optional(Schema.String),
})

export type CreateAlbumInput = typeof CreateAlbumInput.Type

// Admin UI submits full form state on every save (not a diff), so an unset
// field arrives as null, not absent -- optional alone (absent-or-value)
// rejects that. NullOr wrapped in optional accepts absent, value, or null.
export const UpdateAlbumInput = Schema.Struct({
  title: Schema.optional(Schema.NullOr(Schema.String)),
  artistNames: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
  artistIds: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
  releaseDate: Schema.optional(Schema.NullOr(Schema.String)),
  coverImageUrl: Schema.optional(Schema.NullOr(Schema.String)),
  genres: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
  albumType: Schema.optional(Schema.NullOr(Schema.String)),
  slug: Schema.optional(Schema.NullOr(Schema.String)),
  publishedAt: Schema.optional(Schema.NullOr(Schema.String)),
})

export type UpdateAlbumInput = typeof UpdateAlbumInput.Type

// Mirrors selectMusicTrackSchema.
export const TrackResponse = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  artistNames: Schema.NullOr(Schema.Array(Schema.String)),
  coverImageUrl: Schema.NullOr(Schema.String),
  albumId: Schema.NullOr(Schema.String),
  trackNumber: Schema.NullOr(Schema.Number),
  slug: Schema.String,
  publishedAt: Schema.NullOr(Schema.String),
  createdById: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
})

export type TrackResponse = typeof TrackResponse.Type

export const TrackListResponse = Schema.Array(TrackResponse)

export const CreateTrackInput = Schema.Struct({
  title: NonEmptyString,
  artistNames: Schema.optional(Schema.Array(Schema.String)),
  artistIds: Schema.optional(Schema.Array(Schema.String)),
  coverImageUrl: Schema.optional(Schema.String),
  albumId: Schema.optional(Schema.String),
  trackNumber: Schema.optional(Schema.Number),
  slug: NonEmptyString,
  publishedAt: Schema.optional(Schema.String),
})

export type CreateTrackInput = typeof CreateTrackInput.Type

// See UpdateAlbumInput for why NullOr wraps every optional field.
export const UpdateTrackInput = Schema.Struct({
  title: Schema.optional(Schema.NullOr(Schema.String)),
  artistNames: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
  artistIds: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
  coverImageUrl: Schema.optional(Schema.NullOr(Schema.String)),
  albumId: Schema.optional(Schema.NullOr(Schema.String)),
  trackNumber: Schema.optional(Schema.NullOr(Schema.Number)),
  slug: Schema.optional(Schema.NullOr(Schema.String)),
  publishedAt: Schema.optional(Schema.NullOr(Schema.String)),
})

export type UpdateTrackInput = typeof UpdateTrackInput.Type

// Mirrors selectMusicPlaylistSchema -- spotifyUrl is optional+nullable in the
// DB schema (derived field, not a real column on every row shape).
export const PlaylistResponse = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.NullOr(Schema.String),
  coverImageUrl: Schema.NullOr(Schema.String),
  curatorId: Schema.NullOr(Schema.String),
  slug: Schema.String,
  publishedAt: Schema.NullOr(Schema.String),
  createdById: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  spotifyUrl: Schema.optional(Schema.NullOr(Schema.String)),
})

export type PlaylistResponse = typeof PlaylistResponse.Type

export const PlaylistListResponse = Schema.Array(PlaylistResponse)

export const CreatePlaylistInput = Schema.Struct({
  title: NonEmptyString,
  description: Schema.optional(Schema.String),
  coverImageUrl: Schema.optional(Schema.String),
  curatorId: Schema.optional(Schema.String),
  slug: NonEmptyString,
  publishedAt: Schema.optional(Schema.String),
})

export type CreatePlaylistInput = typeof CreatePlaylistInput.Type

// See UpdateAlbumInput for why NullOr wraps every optional field.
export const UpdatePlaylistInput = Schema.Struct({
  title: Schema.optional(Schema.NullOr(Schema.String)),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  coverImageUrl: Schema.optional(Schema.NullOr(Schema.String)),
  curatorId: Schema.optional(Schema.NullOr(Schema.String)),
  slug: Schema.optional(Schema.NullOr(Schema.String)),
  publishedAt: Schema.optional(Schema.NullOr(Schema.String)),
})

export type UpdatePlaylistInput = typeof UpdatePlaylistInput.Type

export const LabelCreatorResponse = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
})

export const LabelResponse = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  imageUrl: Schema.NullOr(Schema.String),
  bannerImageUrl: Schema.NullOr(Schema.String),
  slug: Schema.String,
  content: Schema.String,
  tags: Schema.NullOr(Schema.Array(Schema.String)),
  genres: Schema.NullOr(Schema.Array(Schema.String)),
  publishedAt: Schema.NullOr(Schema.String),
  createdById: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  compiledContent: Schema.optional(Schema.String),
  richContent: Schema.optional(RichContentDocument),
  creators: Schema.optional(Schema.Array(LabelCreatorResponse)),
  affiliatedArtists: Schema.optional(Schema.Array(ArtistResponse)),
  affiliatedAlbums: Schema.optional(Schema.Array(AlbumResponse)),
})

export type LabelResponse = typeof LabelResponse.Type

export const LabelListResponse = Schema.Array(LabelResponse)

export const CreateLabelInput = Schema.Struct({
  name: NonEmptyString,
  description: Schema.optional(Schema.String),
  imageUrl: Schema.optional(Schema.String),
  bannerImageUrl: Schema.optional(Schema.String),
  slug: NonEmptyString,
  content: Schema.String,
  tags: Schema.optional(Schema.Array(Schema.String)),
  genres: Schema.optional(Schema.Array(Schema.String)),
  publishedAt: Schema.optional(Schema.String),
})

export type CreateLabelInput = typeof CreateLabelInput.Type

export const UpdateLabelInput = Schema.Struct({
  name: Schema.optional(Schema.NullOr(Schema.String)),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  imageUrl: Schema.optional(Schema.NullOr(Schema.String)),
  bannerImageUrl: Schema.optional(Schema.NullOr(Schema.String)),
  slug: Schema.optional(Schema.NullOr(Schema.String)),
  content: Schema.optional(Schema.NullOr(Schema.String)),
  tags: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
  genres: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
  publishedAt: Schema.optional(Schema.NullOr(Schema.String)),
})

export type UpdateLabelInput = typeof UpdateLabelInput.Type

export const PlaylistTrackEntry = Schema.Struct({
  track: TrackResponse,
  position: Schema.Number,
  addedAt: Schema.String,
  links: Schema.Array(Schema.Unknown),
})

export const AddTrackToPlaylistInput = Schema.Struct({
  trackId: Schema.String,
  position: Schema.Number,
})

export const AddTrackToPlaylistResponse = Schema.Struct({
  playlistId: Schema.String,
  trackId: Schema.String,
  position: Schema.Number,
  addedAt: Schema.String,
})

export const ReorderPlaylistTracksInput = Schema.Struct({
  trackIds: Schema.Array(Schema.String),
})

const UrlPattern = /^https?:\/\/.+/i

const UrlString = Schema.String.pipe(Schema.check(Schema.isPattern(UrlPattern)))

export const AddSpotifyTrackToPlaylistInput = Schema.Struct({
  url: UrlString,
})

export const AddSpotifyTrackResultResponse = Schema.Struct({
  trackId: Schema.String,
  position: Schema.Number,
  created: Schema.Boolean,
})

export const ImportSpotifyPlaylistInput = Schema.Struct({
  url: UrlString,
})

export const ImportSpotifyPlaylistResponse = Schema.Struct({
  status: Schema.Literal('Imported'),
  playlistId: Schema.String,
  trackCount: Schema.Number,
  createdTrackCount: Schema.Number,
  reusedTrackCount: Schema.Number,
  enrichmentStatus: Schema.Literals(['Accepted', 'Unavailable']),
})

export const SyncPlaylistLinksResponse = Schema.Struct({
  playlistId: Schema.String,
  status: Schema.Literal('Accepted'),
})

const albumIdParam = { id: Schema.String }

const trackIdParam = { id: Schema.String }

const playlistIdParam = { id: Schema.String }

const labelIdParam = { id: Schema.String }

// Mirrors apps/server/src/db/music-entity.schema.ts's MUSIC_ENTITY_TYPES,
// MUSIC_PLATFORMS, LINK_STATUSES.
export const EntityType = Schema.Literals(['artist', 'album', 'track', 'playlist', 'label'])

export const ScrapeEntityType = Schema.Literals(['artist', 'album', 'track', 'playlist'])

export const MusicPlatform = Schema.Literals([
  'spotify',
  'youtube',
  'youtube_music',
  'apple_music',
  'bandcamp',
  'soundcloud',
  'tidal',
  'deezer',
  'amazon_music',
  'discord',
  'website',
  'instagram',
  'twitter',
  'musicbrainz',
  'discogs',
  'other',
])

export const LinkStatus = Schema.Literals(['verified', 'rejected'])

// Mirrors selectMusicEntityLinkSchema -- entityType/platform/status use plain
// String in the select shape (Drizzle types varchar FK columns as string;
// enum validation is enforced on inputs only), same convention the old Hono
// select schema used.
export const EntityLinkResponse = Schema.Struct({
  id: Schema.String,
  entityType: Schema.String,
  entityId: Schema.String,
  platform: Schema.String,
  url: Schema.String,
  status: Schema.String,
  scrapedAt: Schema.NullOr(Schema.String),
  verifiedAt: Schema.NullOr(Schema.String),
  verifiedBy: Schema.NullOr(Schema.String),
  metadata: Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
  createdAt: Schema.String,
  updatedAt: Schema.String,
})

export type EntityLinkResponse = typeof EntityLinkResponse.Type

export const EntityLinkListResponse = Schema.Array(EntityLinkResponse)

const entityLinkParams = { entityType: EntityType, entityId: Schema.String }

export const AddEntityLinkInput = Schema.Struct({
  platform: MusicPlatform,
  url: UrlString,
  status: Schema.optional(LinkStatus),
})

export const UpdateEntityLinkStatusInput = Schema.Struct({
  status: LinkStatus,
  metadata: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown))),
})

export const ResolveMusicEntityInput = Schema.Struct({
  url: UrlString,
  origin: Schema.optional(Schema.Literals(['editorial', 'tweet', 'reply'])),
})

export const ResolvedArtistResponse = Schema.Struct({
  entityType: Schema.Literal('artist'),
  entity: ArtistResponse,
  links: EntityLinkListResponse,
  coverImageUrl: Schema.NullOr(Schema.String),
})

export const ResolvedAlbumResponse = Schema.Struct({
  entityType: Schema.Literal('album'),
  entity: AlbumResponse,
  links: EntityLinkListResponse,
  coverImageUrl: Schema.NullOr(Schema.String),
})

export const ResolvedTrackResponse = Schema.Struct({
  entityType: Schema.Literal('track'),
  entity: TrackResponse,
  links: EntityLinkListResponse,
  coverImageUrl: Schema.NullOr(Schema.String),
})

export const ResolvedPlaylistResponse = Schema.Struct({
  entityType: Schema.Literal('playlist'),
  entity: PlaylistResponse,
  links: EntityLinkListResponse,
  coverImageUrl: Schema.NullOr(Schema.String),
})

export const ResolvedMusicEntityResponse = Schema.Union([
  ResolvedArtistResponse,
  ResolvedAlbumResponse,
  ResolvedTrackResponse,
  ResolvedPlaylistResponse,
])

export type ResolvedMusicEntityResponse = typeof ResolvedMusicEntityResponse.Type

export type EmbeddableResolvedMusicEntityResponse = Exclude<
  ResolvedMusicEntityResponse,
  { readonly entityType: 'artist' }
>

export const ScrapeEntityLinksInput = Schema.Struct({
  url: Schema.optional(UrlString),
  artistName: Schema.optional(Schema.String),
  albumTitle: Schema.optional(Schema.String),
  trackTitle: Schema.optional(Schema.String),
  mbid: Schema.optional(Schema.String),
  isrc: Schema.optional(Schema.String),
})

export type ScrapeMusicEntityResponse =
  | ArtistResponse
  | AlbumResponse
  | TrackResponse
  | PlaylistResponse

export const ScrapeEntityLinksResponse = Schema.Struct({
  entity: Schema.Union([ArtistResponse, AlbumResponse, TrackResponse, PlaylistResponse]),
  links: EntityLinkListResponse,
})

export const RescrapeEntityLinksResponse = Schema.Struct({
  links: EntityLinkListResponse,
})

export const MusicGroup = /* @__PURE__ */ (() =>
  HttpApiGroup.make('music')
    .add(HttpApiEndpoint.get('listArtists', '/api/music/artists', { success: ArtistListResponse }))
    .add(
      HttpApiEndpoint.post('createArtist', '/api/music/artists', {
        payload: CreateArtistInput,
        success: ArtistResponse,
        error: HttpApiError.Forbidden,
      }).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.get('getArtist', '/api/music/artists/:id', {
        params: artistIdParam,
        success: ArtistResponse,
        error: HttpApiError.NotFound,
      }),
    )
    .add(
      HttpApiEndpoint.patch('updateArtist', '/api/music/artists/:id', {
        params: artistIdParam,
        payload: UpdateArtistInput,
        success: ArtistResponse,
        error: [HttpApiError.NotFound, HttpApiError.Forbidden],
      }).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.delete('deleteArtist', '/api/music/artists/:id', {
        params: artistIdParam,
        success: HttpApiSchema.NoContent,
        error: [HttpApiError.NotFound, HttpApiError.Forbidden],
      }).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.get('listArtistLabels', '/api/music/artists/:artistId/labels', {
        params: { artistId: Schema.String },
        success: LabelListResponse,
        error: HttpApiError.Forbidden,
      }).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.put('addArtistToAlbum', '/api/music/albums/:albumId/artists/:artistId', {
        params: { albumId: Schema.String, artistId: Schema.String },
        payload: ArtistJunctionInput,
        success: HttpApiSchema.NoContent,
        error: HttpApiError.Forbidden,
      }).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.delete(
        'removeArtistFromAlbum',
        '/api/music/albums/:albumId/artists/:artistId',
        {
          params: { albumId: Schema.String, artistId: Schema.String },
          success: HttpApiSchema.NoContent,
          error: HttpApiError.Forbidden,
        },
      ).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.put('addArtistToTrack', '/api/music/tracks/:trackId/artists/:artistId', {
        params: { trackId: Schema.String, artistId: Schema.String },
        payload: ArtistJunctionInput,
        success: HttpApiSchema.NoContent,
        error: HttpApiError.Forbidden,
      }).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.delete(
        'removeArtistFromTrack',
        '/api/music/tracks/:trackId/artists/:artistId',
        {
          params: { trackId: Schema.String, artistId: Schema.String },
          success: HttpApiSchema.NoContent,
          error: HttpApiError.Forbidden,
        },
      ).middleware(AuthMiddleware),
    )
    // ---------------------------------------------------------------------
    // Albums
    // ---------------------------------------------------------------------
    .add(HttpApiEndpoint.get('listAlbums', '/api/music/albums', { success: AlbumListResponse }))
    .add(
      HttpApiEndpoint.post('createAlbum', '/api/music/albums', {
        payload: CreateAlbumInput,
        success: AlbumResponse,
        error: HttpApiError.Forbidden,
      }).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.get('getAlbum', '/api/music/albums/:id', {
        params: albumIdParam,
        success: AlbumResponse,
        error: HttpApiError.NotFound,
      }),
    )
    .add(
      HttpApiEndpoint.patch('updateAlbum', '/api/music/albums/:id', {
        params: albumIdParam,
        payload: UpdateAlbumInput,
        success: AlbumResponse,
        error: [HttpApiError.NotFound, HttpApiError.Forbidden],
      }).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.delete('deleteAlbum', '/api/music/albums/:id', {
        params: albumIdParam,
        success: HttpApiSchema.NoContent,
        error: [HttpApiError.NotFound, HttpApiError.Forbidden],
      }).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.get('listAlbumLabels', '/api/music/albums/:albumId/labels', {
        params: { albumId: Schema.String },
        success: LabelListResponse,
        error: HttpApiError.Forbidden,
      }).middleware(AuthMiddleware),
    )
    // ---------------------------------------------------------------------
    // Tracks
    // ---------------------------------------------------------------------
    .add(HttpApiEndpoint.get('listTracks', '/api/music/tracks', { success: TrackListResponse }))
    .add(
      HttpApiEndpoint.post('createTrack', '/api/music/tracks', {
        payload: CreateTrackInput,
        success: TrackResponse,
        error: HttpApiError.Forbidden,
      }).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.get('getTrack', '/api/music/tracks/:id', {
        params: trackIdParam,
        success: TrackResponse,
        error: HttpApiError.NotFound,
      }),
    )
    .add(
      HttpApiEndpoint.patch('updateTrack', '/api/music/tracks/:id', {
        params: trackIdParam,
        payload: UpdateTrackInput,
        success: TrackResponse,
        error: [HttpApiError.NotFound, HttpApiError.Forbidden],
      }).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.delete('deleteTrack', '/api/music/tracks/:id', {
        params: trackIdParam,
        success: HttpApiSchema.NoContent,
        error: [HttpApiError.NotFound, HttpApiError.Forbidden],
      }).middleware(AuthMiddleware),
    )
    // ---------------------------------------------------------------------
    // Playlists
    // ---------------------------------------------------------------------
    .add(
      HttpApiEndpoint.get('listPlaylists', '/api/music/playlists', {
        success: PlaylistListResponse,
      }),
    )
    .add(
      HttpApiEndpoint.post('createPlaylist', '/api/music/playlists', {
        payload: CreatePlaylistInput,
        success: PlaylistResponse,
        error: HttpApiError.Forbidden,
      }).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.get('getPlaylist', '/api/music/playlists/:id', {
        params: playlistIdParam,
        success: PlaylistResponse,
        error: HttpApiError.NotFound,
      }),
    )
    .add(
      HttpApiEndpoint.patch('updatePlaylist', '/api/music/playlists/:id', {
        params: playlistIdParam,
        payload: UpdatePlaylistInput,
        success: PlaylistResponse,
        error: [HttpApiError.NotFound, HttpApiError.Forbidden],
      }).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.delete('deletePlaylist', '/api/music/playlists/:id', {
        params: playlistIdParam,
        success: HttpApiSchema.NoContent,
        error: [HttpApiError.NotFound, HttpApiError.Forbidden],
      }).middleware(AuthMiddleware),
    )
    .add(HttpApiEndpoint.get('listLabels', '/api/music/labels', { success: LabelListResponse }))
    .add(
      HttpApiEndpoint.get('listLabelsForAdmin', '/api/music/labels/manage', {
        success: LabelListResponse,
        error: HttpApiError.Forbidden,
      }).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.post('createLabel', '/api/music/labels', {
        payload: CreateLabelInput,
        success: LabelResponse,
        error: [HttpApiError.Forbidden, ValidationHttpError],
      }).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.get('getLabelBySlug', '/api/music/labels/slug/:slug', {
        params: { slug: Schema.String },
        success: LabelResponse,
        error: HttpApiError.NotFound,
      }),
    )
    .add(
      HttpApiEndpoint.get('getLabel', '/api/music/labels/:id', {
        params: labelIdParam,
        success: LabelResponse,
        error: [HttpApiError.NotFound, HttpApiError.Forbidden],
      }).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.patch('updateLabel', '/api/music/labels/:id', {
        params: labelIdParam,
        payload: UpdateLabelInput,
        success: LabelResponse,
        error: [HttpApiError.NotFound, HttpApiError.Forbidden, ValidationHttpError],
      }).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.delete('deleteLabel', '/api/music/labels/:id', {
        params: labelIdParam,
        success: HttpApiSchema.NoContent,
        error: [HttpApiError.NotFound, HttpApiError.Forbidden],
      }).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.get('listLabelArtists', '/api/music/labels/:labelId/artists', {
        params: { labelId: Schema.String },
        success: ArtistListResponse,
        error: HttpApiError.Forbidden,
      }).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.get('listLabelAlbums', '/api/music/labels/:labelId/albums', {
        params: { labelId: Schema.String },
        success: AlbumListResponse,
        error: HttpApiError.Forbidden,
      }).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.put(
        'affiliateArtistWithLabel',
        '/api/music/labels/:labelId/artists/:artistId',
        {
          params: { labelId: Schema.String, artistId: Schema.String },
          success: HttpApiSchema.NoContent,
          error: [HttpApiError.NotFound, HttpApiError.Forbidden],
        },
      ).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.delete(
        'unaffiliateArtistFromLabel',
        '/api/music/labels/:labelId/artists/:artistId',
        {
          params: { labelId: Schema.String, artistId: Schema.String },
          success: HttpApiSchema.NoContent,
          error: HttpApiError.Forbidden,
        },
      ).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.put('affiliateAlbumWithLabel', '/api/music/labels/:labelId/albums/:albumId', {
        params: { labelId: Schema.String, albumId: Schema.String },
        success: HttpApiSchema.NoContent,
        error: [HttpApiError.NotFound, HttpApiError.Forbidden],
      }).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.delete(
        'unaffiliateAlbumFromLabel',
        '/api/music/labels/:labelId/albums/:albumId',
        {
          params: { labelId: Schema.String, albumId: Schema.String },
          success: HttpApiSchema.NoContent,
          error: HttpApiError.Forbidden,
        },
      ).middleware(AuthMiddleware),
    )
    // ---------------------------------------------------------------------
    // Playlist tracks
    // ---------------------------------------------------------------------
    .add(
      HttpApiEndpoint.get('getPlaylistTracks', '/api/music/playlists/:id/tracks', {
        params: playlistIdParam,
        success: Schema.Array(PlaylistTrackEntry),
        error: HttpApiError.NotFound,
      }),
    )
    .add(
      HttpApiEndpoint.post('addTrackToPlaylist', '/api/music/playlists/:id/tracks', {
        params: playlistIdParam,
        payload: AddTrackToPlaylistInput,
        success: AddTrackToPlaylistResponse,
        error: HttpApiError.Forbidden,
      }).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.delete(
        'removeTrackFromPlaylist',
        '/api/music/playlists/:id/tracks/:trackId',
        {
          params: { id: Schema.String, trackId: Schema.String },
          success: HttpApiSchema.NoContent,
          error: HttpApiError.Forbidden,
        },
      ).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.put('reorderPlaylistTracks', '/api/music/playlists/:id/tracks/order', {
        params: playlistIdParam,
        payload: ReorderPlaylistTracksInput,
        success: HttpApiSchema.NoContent,
        error: [HttpApiError.BadRequest, HttpApiError.Forbidden],
      }).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.post('addSpotifyTrackToPlaylist', '/api/music/playlists/:id/tracks/spotify', {
        params: playlistIdParam,
        payload: AddSpotifyTrackToPlaylistInput,
        success: AddSpotifyTrackResultResponse,
        error: [
          HttpApiError.BadRequest,
          HttpApiError.NotFound,
          HttpApiError.Conflict,
          HttpApiError.Forbidden,
          MusicServiceUnavailableHttpError,
        ],
      }).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.post('importSpotifyPlaylist', '/api/music/playlists/import/spotify', {
        payload: ImportSpotifyPlaylistInput,
        success: ImportSpotifyPlaylistResponse,
        error: [
          HttpApiError.BadRequest,
          HttpApiError.NotFound,
          HttpApiError.Conflict,
          HttpApiError.Forbidden,
          MusicServiceUnavailableHttpError,
        ],
      }).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.post('syncPlaylistLinks', '/api/music/playlists/:id/sync-links', {
        params: playlistIdParam,
        success: SyncPlaylistLinksResponse,
        error: [
          HttpApiError.BadRequest,
          HttpApiError.NotFound,
          HttpApiError.Conflict,
          HttpApiError.Forbidden,
          MusicServiceUnavailableHttpError,
        ],
      }).middleware(AuthMiddleware),
    )
    // ---------------------------------------------------------------------
    // Resolve a pasted URL into a music entity
    // ---------------------------------------------------------------------
    .add(
      HttpApiEndpoint.post('resolveMusicEntity', '/api/music/resolve', {
        payload: ResolveMusicEntityInput,
        success: ResolvedMusicEntityResponse,
        error: [
          HttpApiError.BadRequest,
          HttpApiError.NotFound,
          HttpApiError.Conflict,
          HttpApiError.Forbidden,
          MusicServiceUnavailableHttpError,
        ],
      }).middleware(AuthMiddleware),
    )
    // ---------------------------------------------------------------------
    // Links -- per entity
    // ---------------------------------------------------------------------
    .add(
      HttpApiEndpoint.get('listEntityLinks', '/api/music/:entityType/:entityId/links', {
        params: entityLinkParams,
        query: Schema.Struct({ status: Schema.optional(LinkStatus) }),
        success: EntityLinkListResponse,
      }),
    )
    .add(
      HttpApiEndpoint.post('addEntityLink', '/api/music/:entityType/:entityId/links', {
        params: entityLinkParams,
        payload: AddEntityLinkInput,
        success: EntityLinkResponse,
        error: [
          HttpApiError.BadRequest,
          HttpApiError.NotFound,
          HttpApiError.Conflict,
          HttpApiError.Forbidden,
          MusicServiceUnavailableHttpError,
        ],
      }).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.patch(
        'updateEntityLinkStatus',
        '/api/music/:entityType/:entityId/links/:linkId',
        {
          params: { ...entityLinkParams, linkId: Schema.String },
          payload: UpdateEntityLinkStatusInput,
          success: EntityLinkResponse,
          error: [
            HttpApiError.BadRequest,
            HttpApiError.NotFound,
            HttpApiError.Conflict,
            HttpApiError.Forbidden,
            MusicServiceUnavailableHttpError,
          ],
        },
      ).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.delete('deleteEntityLink', '/api/music/:entityType/:entityId/links/:linkId', {
        params: { ...entityLinkParams, linkId: Schema.String },
        success: HttpApiSchema.NoContent,
        error: [
          HttpApiError.BadRequest,
          HttpApiError.NotFound,
          HttpApiError.Conflict,
          HttpApiError.Forbidden,
          MusicServiceUnavailableHttpError,
        ],
      }).middleware(AuthMiddleware),
    )
    .add(
      HttpApiEndpoint.post(
        'rescrapeEntityLinks',
        '/api/music/:entityType/:entityId/links/rescrape',
        {
          params: { entityType: ScrapeEntityType, entityId: Schema.String },
          success: RescrapeEntityLinksResponse,
          error: [
            HttpApiError.BadRequest,
            HttpApiError.NotFound,
            HttpApiError.Conflict,
            HttpApiError.Forbidden,
            MusicServiceUnavailableHttpError,
          ],
        },
      ).middleware(AuthMiddleware),
    )
    // ---------------------------------------------------------------------
    // Scrape -- trigger link discovery for an entity
    // ---------------------------------------------------------------------
    .add(
      HttpApiEndpoint.post('scrapeEntityLinks', '/api/music/:entityType/scrape', {
        params: { entityType: ScrapeEntityType },
        payload: ScrapeEntityLinksInput,
        success: ScrapeEntityLinksResponse,
        error: [
          HttpApiError.BadRequest,
          HttpApiError.NotFound,
          HttpApiError.Conflict,
          HttpApiError.Forbidden,
          MusicServiceUnavailableHttpError,
        ],
      }).middleware(AuthMiddleware),
    ))()
// ---------------------------------------------------------------------
