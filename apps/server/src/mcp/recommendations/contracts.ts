import { PostId, PostVersion } from '@gbfm/core/editorial-mcp'
import { Schema } from 'effect'

import { EndpointIdentity } from '../contracts'
import { EvidenceId } from '../editorial-research/contracts'

export const MusicRef = Schema.Struct({
  entityType: Schema.Literals(['artist', 'album', 'track']),
  entityId: EvidenceId,
})

export type MusicRef = typeof MusicRef.Type

export const SimilarInput = Schema.Struct({
  seed: MusicRef,
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 20 }))),
}).annotate({ parseOptions: { onExcessProperty: 'error' } })

export const EvidenceSubject = Schema.Struct({
  entityType: Schema.Literals(['artist', 'album', 'track', 'label', 'genre', 'post', 'playlist']),
  entityId: EvidenceId,
})

export const RankingEvidence = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(['same_album', 'shared_artist', 'shared_music_label', 'shared_genre']),
  subjects: Schema.Array(EvidenceSubject),
  witnessId: EvidenceId,
  sourceLocator: Schema.String,
  sourceFingerprint: Schema.String,
  observedAt: Schema.String,
})

export type RankingEvidence = typeof RankingEvidence.Type

export const RecommendationLimit = Schema.Struct({
  code: Schema.Literals([
    'candidate_window_truncated',
    'seed_edge_window',
    'missing_relation',
    'unsupported_seed_relation',
    'missing_structured_reference',
    'missing_eligible_reference',
    'tied_positions',
  ]),
  affected: Schema.NullOr(EvidenceSubject),
  relationKind: Schema.NullOr(RankingEvidence.fields.kind),
})

export const SimilarResult = Schema.Struct({
  contractVersion: Schema.Literal(1),
  algorithmVersion: Schema.Literal('catalogue_relations_v1'),
  endpoint: EndpointIdentity,
  observedAt: Schema.String,
  status: Schema.Literals(['sufficient', 'insufficient_evidence']),
  inputs: Schema.Struct({ seed: MusicRef, seedVersion: Schema.String, limit: Schema.Int }),
  basisDigest: Schema.String,
  evidence: Schema.Array(RankingEvidence),
  limits: Schema.Array(RecommendationLimit),
  candidateWindow: Schema.Struct({
    examined: Schema.Int,
    cap: Schema.Literal(200),
    truncated: Schema.Boolean,
  }),
  candidates: Schema.Array(
    Schema.Struct({
      music: MusicRef,
      name: Schema.String,
      slug: Schema.String,
      tier: Schema.Int,
      evidenceIds: Schema.Array(Schema.String),
      explanation: Schema.String.check(Schema.isMaxLength(500)),
    }),
  ),
})

/** MCP requires an object root; the refinement preserves the exclusive seed contract. */
export const ConnectionsInput = Schema.Struct({
  music: Schema.optionalKey(MusicRef),
  postId: Schema.optionalKey(PostId),
  expectedVersion: Schema.optionalKey(PostVersion),
  limit: SimilarInput.fields.limit,
})
  .check(
    Schema.makeFilter(
      (value) =>
        (value.music === undefined) !== (value.postId === undefined) &&
        (value.expectedVersion === undefined || value.postId !== undefined),
    ),
  )
  .annotate({ parseOptions: { onExcessProperty: 'error' } })

export const ConnectionEvidence = Schema.Union([
  RankingEvidence,
  Schema.Struct({
    id: Schema.String,
    kind: Schema.Literal('post_music_reference'),
    subjects: Schema.Array(EvidenceSubject),
    sourceLocator: Schema.String,
    sourceFingerprint: Schema.String,
    observedAt: Schema.String,
  }),
])

export const ConnectionsResult = Schema.Struct({
  contractVersion: Schema.Literal(1),
  algorithmVersion: Schema.Literal('editorial_relations_v1'),
  endpoint: EndpointIdentity,
  observedAt: Schema.String,
  status: SimilarResult.fields.status,
  inputs: Schema.Struct({
    music: Schema.NullOr(MusicRef),
    postId: Schema.NullOr(PostId),
    postVersion: Schema.NullOr(PostVersion),
    seedVersion: Schema.NullOr(Schema.String),
    limit: Schema.Int,
  }),
  evidence: Schema.Array(ConnectionEvidence),
  limits: Schema.Array(RecommendationLimit),
  basisDigest: Schema.String,
  candidateWindow: SimilarResult.fields.candidateWindow,
  candidates: Schema.Array(
    Schema.Struct({
      postId: PostId,
      title: Schema.NullOr(Schema.String),
      url: Schema.String,
      tier: Schema.Int,
      evidenceIds: Schema.Array(Schema.String),
      explanation: Schema.String.check(Schema.isMaxLength(500)),
    }),
  ),
})

export const SequenceInput = Schema.Struct({
  playlistId: EvidenceId,
  expectedRevision: Schema.Int.check(
    Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  ),
  strategy: Schema.Literal('album_blocks_v1'),
}).annotate({ parseOptions: { onExcessProperty: 'error' } })

export const SequenceEvidence = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literal('album_track_order'),
  subjects: Schema.Array(EvidenceSubject),
  albumId: EvidenceId,
  members: Schema.Array(
    Schema.Struct({
      trackId: EvidenceId,
      originalPosition: Schema.Int,
      trackNumber: Schema.NullOr(Schema.Int),
    }),
  ),
  sourceLocator: Schema.String,
  sourceFingerprint: Schema.String,
  observedAt: Schema.String,
})

export const SequenceResult = Schema.Struct({
  contractVersion: Schema.Literal(1),
  algorithmVersion: Schema.Literal('album_blocks_v1'),
  endpoint: EndpointIdentity,
  observedAt: Schema.String,
  status: SimilarResult.fields.status,
  inputs: Schema.Struct({ ...SequenceInput.fields, seedVersion: Schema.String }),
  basisDigest: Schema.String,
  evidence: Schema.Array(SequenceEvidence),
  limits: Schema.Array(RecommendationLimit),
  candidateWindow: Schema.Struct({
    examined: Schema.Int,
    cap: Schema.Literal(100),
    truncated: Schema.Literal(false),
  }),
  basisRevision: Schema.Int,
  originalTrackIds: Schema.Array(EvidenceId),
  proposedTrackIds: Schema.Array(EvidenceId),
  positions: Schema.Array(Schema.Struct({ trackId: EvidenceId, position: Schema.Int })),
  changed: Schema.Boolean,
  blocks: Schema.Array(
    Schema.Struct({
      albumId: EvidenceId,
      evidenceIds: Schema.Array(Schema.String),
      explanation: Schema.String.check(Schema.isMaxLength(500)),
    }),
  ),
})
