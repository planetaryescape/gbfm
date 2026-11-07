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
