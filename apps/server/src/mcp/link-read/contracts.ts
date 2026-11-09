import { Schema } from 'effect'

import { MUSIC_PLATFORMS } from '@/db/music-entity.schema'

import { EndpointIdentity } from '../contracts'
import { MusicKind, MusicRef } from '../music-read/contracts'

export const Platform = Schema.Literals(MUSIC_PLATFORMS)

const limit = Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 })))

export const LinkPageInput = Schema.Struct({
  ...MusicRef.fields,
  limit,
  afterPlatform: Schema.optional(Platform),
})

export const EquivalentInput = Schema.Struct({ ...MusicRef.fields, platform: Platform })

export const HealthInput = Schema.Struct({
  ...MusicRef.fields,
  platform: Platform,
})

export const MissingLinksInput = Schema.Struct({
  entityType: MusicKind,
  platform: Platform,
  limit,
  afterId: Schema.optional(Schema.NonEmptyString.check(Schema.isMaxLength(200))),
})

export const CompareSourcesInput = Schema.Struct({
  leftUrl: Schema.NonEmptyString.check(Schema.isMaxLength(2048)),
  rightUrl: Schema.NonEmptyString.check(Schema.isMaxLength(2048)),
})

export const StoredLink = Schema.Struct({
  linkId: Schema.String,
  platform: Platform,
  url: Schema.String,
  status: Schema.Literal('verified'),
  observedUpdatedAt: Schema.String,
  verifiedAt: Schema.NullOr(Schema.String),
})

export const LinksResult = Schema.Struct({
  endpoint: EndpointIdentity,
  source: MusicRef,
  links: Schema.Array(StoredLink),
  scanned: Schema.Int,
  nextAfterPlatform: Schema.NullOr(Platform),
})

export const EquivalentResult = Schema.Struct({
  endpoint: EndpointIdentity,
  source: MusicRef,
  result: Schema.Union([
    Schema.Struct({
      status: Schema.Literal('stored_link'),
      evidence: Schema.Literal('verified_link_of_same_catalogue_entry'),
      link: StoredLink,
    }),
    Schema.Struct({ status: Schema.Literal('insufficient_evidence') }),
  ]),
})

export const HealthObservation = Schema.Struct({
  status: Schema.Literals(['reachable', 'not_found', 'provider_unavailable', 'blocked']),
  reason: Schema.Literals([
    'http_status',
    'unsupported_destination',
    'redirect_limit',
    'timeout',
    'transport_unavailable',
  ]),
  httpStatus: Schema.NullOr(Schema.Int),
  requests: Schema.Int,
  checkedAt: Schema.String,
})

export const HealthResult = Schema.Struct({
  endpoint: EndpointIdentity,
  source: MusicRef,
  link: Schema.NullOr(StoredLink),
  observation: Schema.NullOr(HealthObservation),
  evidence: Schema.Literals(['http_availability_only', 'insufficient_stored_evidence']),
})

export const MissingLinksResult = Schema.Struct({
  endpoint: EndpointIdentity,
  platform: Platform,
  missing: Schema.Array(MusicRef),
  scanned: Schema.Int,
  nextAfterId: Schema.NullOr(Schema.String),
})

export const CompareSourcesResult = Schema.Struct({
  endpoint: EndpointIdentity,
  result: Schema.Union([
    Schema.Struct({ status: Schema.Literal('same_catalogue_entry'), entity: MusicRef }),
    Schema.Struct({
      status: Schema.Literal('different_catalogue_entries'),
      left: MusicRef,
      right: MusicRef,
    }),
    Schema.Struct({ status: Schema.Literal('insufficient_evidence') }),
  ]),
  evidence: Schema.Literal('stored_identity_only_not_musical_equivalence'),
})
