import { Schema } from 'effect'

import { EndpointIdentity } from '../contracts'
import { MusicKind, MusicRef } from '../music-read/contracts'

const limit = Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 })))

const cursorId = Schema.NonEmptyString.check(Schema.isMaxLength(200))

export const QualityWindowInput = Schema.Struct({
  entityType: MusicKind,
  afterId: Schema.optional(cursorId),
  limit,
})

export const DuplicateInput = Schema.Struct({
  ...MusicRef.fields,
  afterId: Schema.optional(cursorId),
  limit,
})

export const CompareEntriesInput = Schema.Struct({ left: MusicRef, right: MusicRef })

export const ConflictCursor = Schema.Struct({
  detectedAt: Schema.Int.check(
    Schema.isBetween({ minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }),
  ),
  id: cursorId,
})

export const ConflictInput = Schema.Struct({ after: Schema.optional(ConflictCursor), limit })

export const QualitySummaryInput = Schema.Struct({
  ...QualityWindowInput.fields,
  afterSourceKey: Schema.optional(Schema.NonEmptyString.check(Schema.isMaxLength(1024))),
})

export const MissingField = Schema.Literals([
  'name',
  'artwork',
  'description',
  'release_date',
  'album',
  'artist_credit',
])

export const EntryEvidence = Schema.Struct({
  ...MusicRef.fields,
  name: Schema.String.check(Schema.isMaxLength(400)),
  nameTruncated: Schema.Boolean,
  missingFields: Schema.Array(MissingField),
})

export const DuplicateResult = Schema.Struct({
  endpoint: EndpointIdentity,
  seed: EntryEvidence,
  candidates: Schema.Array(EntryEvidence),
  evidence: Schema.Literal('same_kind_exact_sqlite_casefolded_name_hypothesis_only'),
  nextAfterId: Schema.NullOr(Schema.String),
})

export const CompareEntriesResult = Schema.Struct({
  endpoint: EndpointIdentity,
  left: EntryEvidence,
  right: EntryEvidence,
  sameCatalogueReference: Schema.Boolean,
  sameKind: Schema.Boolean,
  sameCasefoldedName: Schema.Boolean,
  verdict: Schema.Literal('no_musical_equivalence_or_merge_verdict'),
})

export const IncompleteResult = Schema.Struct({
  endpoint: EndpointIdentity,
  entries: Schema.Array(EntryEvidence),
  scanned: Schema.Int,
  nextAfterId: Schema.NullOr(Schema.String),
})

export const ConflictEvidence = Schema.Struct({
  conflictId: Schema.String,
  incumbent: MusicRef,
  candidate: MusicRef,
  status: Schema.Literal('open'),
  detectedAt: Schema.Int,
  evidence: Schema.Literal('stored_identity_conflict_not_equality'),
})

export const ConflictResult = Schema.Struct({
  endpoint: EndpointIdentity,
  conflicts: Schema.Array(ConflictEvidence),
  scanned: Schema.Int,
  nextAfter: Schema.NullOr(ConflictCursor),
})

export const QualitySummaryResult = Schema.Struct({
  endpoint: EndpointIdentity,
  scope: Schema.Literal('examined_windows_only_not_catalogue_totals'),
  catalogue: Schema.Struct({
    entityType: MusicKind,
    scanned: Schema.Int,
    incomplete: Schema.Int,
    nextAfterId: Schema.NullOr(Schema.String),
  }),
  resolvingIdentities: Schema.Struct({
    scanned: Schema.Int,
    active: Schema.Int,
    expired: Schema.Int,
    complete: Schema.Boolean,
    nextSourceKey: Schema.NullOr(Schema.String),
  }),
})
