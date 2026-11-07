import { Schema } from 'effect'

import { EndpointIdentity } from '../contracts'

/** R1 deliberately excludes playlists pending PL1's shared visibility prerequisite. */
export const MusicKind = Schema.Literals(['artist', 'album', 'track', 'label'])

const id = Schema.NonEmptyString.check(Schema.isMaxLength(200))

const name = Schema.NonEmptyString.check(Schema.isMaxLength(200))

/** Stable catalogue reference; never an audio mix or episode ID. */
export const MusicRef = Schema.Struct({ entityType: MusicKind, entityId: id })

/** Lists are deterministic, default 20/max 50, with an explicit bounded offset. */
export const MusicPage = Schema.Struct({
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))),
  offset: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10_000 }))),
})

/** Literal case-insensitive substring search across all four catalogue kinds. */
export const SearchMusicInput = Schema.Struct({
  ...MusicPage.fields,
  query: name,
  entityType: Schema.optional(MusicKind),
})

/** Exact case-insensitive name filter, optionally restricted to one kind. */
export const FilterMusicInput = Schema.Struct({
  ...MusicPage.fields,
  entityType: MusicKind,
  name: Schema.optional(name),
})

/** Batch results preserve input order and duplicates, including missing references. */
export const GetMusicEntitiesInput = Schema.Struct({
  entities: Schema.Array(MusicRef).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
})

/** Stored identity lookup only; the canonical parser enforces URL safety and normalization. */
export const LookupMusicUrlInput = Schema.Struct({
  url: Schema.NonEmptyString.check(Schema.isMaxLength(2048)),
})

/** One-hop relationships only; no playlist traversal or provider-enriched edges. */
export const MusicRelationshipsInput = Schema.Struct({ ...MusicRef.fields, ...MusicPage.fields })

/** Specialized relationship queries require their own stable source ID. */
export const ArtistDiscographyInput = Schema.Struct({ artistId: id, ...MusicPage.fields })

/** Album tracks use track number (null last), then stable track ID. */
export const AlbumTracksInput = Schema.Struct({ albumId: id, ...MusicPage.fields })

/** Label catalogue contains stored artist affiliations and album releases. */
export const LabelCatalogueInput = Schema.Struct({ labelId: id, ...MusicPage.fields })

/** Safe stored links exclude rejected links, credentials and internal provenance. */
export const MusicLink = Schema.Struct({ platform: Schema.String, url: Schema.String })

/** Explicit public projection: no label draft body, actor IDs, metadata or source leases. */
export const MusicEntity = Schema.Struct({
  ...MusicRef.fields,
  name: Schema.String,
  slug: Schema.String,
  observedUpdatedAt: Schema.String,
  links: Schema.Array(MusicLink),
  linksHasMore: Schema.Boolean,
})

/** Successful lookup contains a stable public entity and endpoint identity. */
export const GetMusicEntityResult = Schema.Struct({
  endpoint: EndpointIdentity,
  entity: MusicEntity,
})

const pagination = Schema.Struct({
  limit: Schema.Int,
  offset: Schema.Int,
  hasMore: Schema.Boolean,
})

/** Lists omit unbounded counts and explicitly report whether another page exists. */
export const MusicListResult = Schema.Struct({
  endpoint: EndpointIdentity,
  entities: Schema.Array(MusicEntity),
  pagination,
})

/** Missing batch IDs are data, not a failure of the entire batch. */
export const GetMusicEntitiesResult = Schema.Struct({
  endpoint: EndpointIdentity,
  results: Schema.Array(
    Schema.Union([
      Schema.Struct({ status: Schema.Literal('found'), ref: MusicRef, entity: MusicEntity }),
      Schema.Struct({ status: Schema.Literal('not_found'), ref: MusicRef }),
    ]),
  ),
})

/** Unknown/unresolved/orphaned/gated stored identities share the same safe missing outcome. */
export const LookupMusicUrlResult = Schema.Struct({
  endpoint: EndpointIdentity,
  result: Schema.Union([
    Schema.Struct({ status: Schema.Literal('found'), entity: MusicEntity }),
    Schema.Struct({ status: Schema.Literal('not_found') }),
  ]),
})

/** Edges point from the requested entity to the related entity; direction retains stored semantics. */
export const MusicRelationshipsResult = Schema.Struct({
  endpoint: EndpointIdentity,
  source: MusicRef,
  relationships: Schema.Array(
    Schema.Struct({
      relationship: Schema.Literals([
        'album_artist',
        'track_artist',
        'label_artist',
        'label_album',
        'album_track',
      ]),
      direction: Schema.Literals(['outgoing', 'incoming']),
      role: Schema.NullOr(Schema.String),
      position: Schema.NullOr(Schema.Int),
      entity: MusicEntity,
    }),
  ),
  pagination,
})
