import { PostId, PostVersion } from '@gbfm/core/editorial-mcp'
import { Schema } from 'effect'

import { EndpointIdentity } from '../contracts'

export const EvidenceId = Schema.NonEmptyString.check(Schema.isMaxLength(200))

export const ResearchKind = Schema.Literals(['artist', 'album', 'track', 'label'])

export const ResearchRef = Schema.Struct({ entityType: ResearchKind, entityId: EvidenceId })

export type ResearchRef = typeof ResearchRef.Type

export const ResearchLimit = Schema.optionalKey(
  Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 20 })),
)

export const MusicResearchInput = Schema.Struct({
  ...ResearchRef.fields,
  limit: ResearchLimit,
}).annotate({ parseOptions: { onExcessProperty: 'error' } })

export const GenreResearchInput = Schema.Struct({
  genreId: EvidenceId,
  limit: ResearchLimit,
}).annotate({ parseOptions: { onExcessProperty: 'error' } })

export const LabelResearchInput = Schema.Struct({
  labelId: EvidenceId,
  limit: ResearchLimit,
}).annotate({ parseOptions: { onExcessProperty: 'error' } })

export const ArtistResearchInput = Schema.Struct({
  artistId: EvidenceId,
  limit: ResearchLimit,
}).annotate({ parseOptions: { onExcessProperty: 'error' } })

export const UndercoveredInput = Schema.Struct({
  entities: Schema.Array(ResearchRef).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
}).annotate({ parseOptions: { onExcessProperty: 'error' } })

export const EditorialContextInput = Schema.Struct({
  postId: PostId,
  expectedVersion: Schema.optionalKey(PostVersion),
}).annotate({ parseOptions: { onExcessProperty: 'error' } })

export const EditorialContextResult = Schema.Struct({
  endpoint: EndpointIdentity,
  observedAt: Schema.String,
  post: Schema.Struct({
    postId: PostId,
    version: PostVersion,
    draft: Schema.Boolean,
    title: Schema.NullOr(Schema.String),
    description: Schema.NullOr(Schema.String),
    source: Schema.String,
    sourceTruncated: Schema.Boolean,
    tags: Schema.Array(Schema.String),
    tagsTruncated: Schema.Boolean,
  }),
  references: Schema.Array(
    Schema.Struct({
      entityType: Schema.Literals(['album', 'track', 'playlist']),
      entityId: EvidenceId,
      primary: Schema.Boolean,
      availability: Schema.Literals(['eligible', 'unavailable']),
      name: Schema.NullOr(Schema.String),
    }),
  ),
  sourceLocator: Schema.String,
  sourceFingerprint: Schema.String,
  limitations: Schema.Array(Schema.String),
})

/** Published projection only. An album identity is included only when it also qualifies. */
const EvidenceTimestamp = Schema.Int.check(
  Schema.isBetween({ minimum: -8_640_000_000_000_000, maximum: 8_640_000_000_000_000 }),
)

export const EvidenceEntity = Schema.Struct({
  ...ResearchRef.fields,
  name: Schema.String,
  slug: Schema.String,
  publishedAt: EvidenceTimestamp,
  updatedAt: EvidenceTimestamp,
  albumId: Schema.NullOr(EvidenceId),
  trackNumber: Schema.NullOr(Schema.Int),
})

export type EvidenceEntity = typeof EvidenceEntity.Type

export const EvidenceRelation = Schema.Struct({
  kind: Schema.Literals([
    'album_artist',
    'track_artist',
    'label_artist',
    'label_album',
    'album_track',
    'shared_artist',
    'genre',
    'same_album',
    'shared_music_label',
    'shared_genre',
  ]),
  subject: ResearchRef,
  object: ResearchRef,
  witnessId: Schema.NullOr(EvidenceId),
  role: Schema.NullOr(Schema.String),
  position: Schema.NullOr(Schema.Int),
})

export type EvidenceRelation = typeof EvidenceRelation.Type

/** Fingerprint identifies the exact projected assertion, not mutable URL contents. */
export const Citation = Schema.Struct({
  id: Schema.String,
  sourceLocator: Schema.String,
  sourceFingerprint: Schema.String,
  observedAt: Schema.String,
})

export const EditorialEvidence = Schema.Struct({
  postId: EvidenceId,
  title: Schema.NullOr(Schema.String),
  slug: Schema.String,
  updatedAt: EvidenceTimestamp,
  music: ResearchRef,
})

export const SourceEvidence = Schema.Struct({
  music: ResearchRef,
  platform: Schema.String,
  url: Schema.String,
})

export const ResearchResult = Schema.Struct({
  endpoint: EndpointIdentity,
  observedAt: Schema.String,
  status: Schema.Literals(['sufficient', 'insufficient_evidence']),
  entities: Schema.Array(EvidenceEntity),
  relations: Schema.Array(EvidenceRelation),
  editorials: Schema.Array(EditorialEvidence),
  sources: Schema.Array(SourceEvidence),
  citations: Schema.Array(Citation),
  coverage: Schema.Array(
    Schema.Struct({
      music: ResearchRef,
      sampledMatches: Schema.Int,
      status: Schema.Literals(['recorded_coverage', 'no_match_in_examined_window']),
    }),
  ),
  limitations: Schema.Array(Schema.String),
  hasMore: Schema.Boolean,
})

export type ResearchResult = typeof ResearchResult.Type
