import { Schema } from 'effect'

import { EndpointIdentity } from '../contracts'
import { ContentPageInput, ContentPagination, PublicShowInput } from './contracts'

/** Search pages contain one explicit content namespace, not canonical music entities. */
export const PublicSearchInput = Schema.Struct({
  query: Schema.NonEmptyString.check(Schema.isMaxLength(200)),
  kind: Schema.Literals(['audio', 'show', 'post']),
  ...ContentPageInput.fields,
})

/** Metadata matches only; source bodies, media and related shows are never expanded. */
export const PublicSearchResult = Schema.Struct({
  endpoint: EndpointIdentity,
  kind: PublicSearchInput.fields.kind,
  results: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      slug: Schema.String,
      title: Schema.NullOr(Schema.String),
      description: Schema.NullOr(Schema.String),
      type: Schema.String,
    }),
  ),
  pagination: ContentPagination,
})

/** GBFM audio mix identity is distinct from canonical music-track identity. */
export const PublicMixInput = PublicShowInput

/** Published mix metadata, without playback, body compilation or relationship hydration. */
export const PublicMixResult = Schema.Struct({
  endpoint: EndpointIdentity,
  mix: Schema.Struct({
    audioId: Schema.String,
    slug: Schema.String,
    title: Schema.String,
    description: Schema.NullOr(Schema.String),
    createdAt: Schema.String,
    updatedAt: Schema.String,
    reviewUrl: Schema.String,
  }),
})

/** Username follows the existing public user-first / artist-DJ fallback lookup. */
export const PublicProfileInput = Schema.Struct({
  username: Schema.NonEmptyString.check(Schema.isMaxLength(200)),
})

/** Identity metadata only, not a profile's content graph or hydrated page. */
export const PublicProfileResult = Schema.Struct({
  endpoint: EndpointIdentity,
  profile: Schema.Struct({
    kind: Schema.Literals(['user', 'artist']),
    id: Schema.String,
    name: Schema.String,
    username: Schema.NullOr(Schema.String),
    bio: Schema.NullOr(Schema.String),
    createdAt: Schema.String,
  }),
})

/** Collection identity belongs to listening collections, never playlist revisions. */
export const PublicCollectionInput = Schema.Struct({
  collectionId: Schema.NonEmptyString.check(Schema.isMaxLength(200)),
  ...ContentPageInput.fields,
})

/** Only published same-owner members; notes share the saved mix's publication state. */
export const PublicCollectionResult = Schema.Struct({
  endpoint: EndpointIdentity,
  collection: Schema.Struct({
    id: Schema.String,
    title: Schema.String,
    description: Schema.String,
    ownerName: Schema.String,
  }),
  mixes: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      title: Schema.String,
      url: Schema.String,
      platform: Schema.Literals(['youtube', 'spotify', 'soundcloud', 'mixcloud']),
      notes: Schema.String,
      status: Schema.Literals(['to-listen', 'listening', 'listened']),
    }),
  ),
  pagination: ContentPagination,
})
