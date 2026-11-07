import { Schema } from 'effect'

export const MUSIC_SOURCE_ERROR_REASONS = [
  'invalid_url',
  'unsupported_protocol',
  'credentials',
  'control_character',
  'too_long',
  'unsafe_destination',
  'invalid_provider_source',
  'type_mismatch',
  'platform_mismatch',
  'digest_failed',
] as const

export type MusicSourceErrorReason = (typeof MUSIC_SOURCE_ERROR_REASONS)[number]

export class MusicSourceInvalid extends Schema.TaggedError<MusicSourceInvalid>()(
  'MusicSourceInvalid',
  {
    reason: Schema.Literals(MUSIC_SOURCE_ERROR_REASONS),
    message: Schema.String,
  },
) {}

export class MusicIdentityBusy extends Schema.TaggedError<MusicIdentityBusy>()(
  'MusicIdentityBusy',
  { retryAfterMs: Schema.Number },
) {}

export class MusicIdentityAliasCollision extends Schema.TaggedError<MusicIdentityAliasCollision>()(
  'MusicIdentityAliasCollision',
  {
    normalizedUrl: Schema.String,
    expectedSourceKey: Schema.String,
    storedSourceKey: Schema.String,
  },
) {}

export class MusicIdentityConflict extends Schema.TaggedError<MusicIdentityConflict>()(
  'MusicIdentityConflict',
  {
    sourceKey: Schema.String,
    incumbentEntityType: Schema.String,
    incumbentEntityId: Schema.String,
    candidateEntityType: Schema.String,
    candidateEntityId: Schema.String,
  },
) {}

export class MusicIdentityEntityNotFound extends Schema.TaggedError<MusicIdentityEntityNotFound>()(
  'MusicIdentityEntityNotFound',
  { entityType: Schema.String, entityId: Schema.String },
) {}

export class MusicIdentitySourceLinkNotFound extends Schema.TaggedError<MusicIdentitySourceLinkNotFound>()(
  'MusicIdentitySourceLinkNotFound',
  { entityType: Schema.String, entityId: Schema.String },
) {}

export class MusicIdentityInvalidSnapshot extends Schema.TaggedError<MusicIdentityInvalidSnapshot>()(
  'MusicIdentityInvalidSnapshot',
  { message: Schema.String },
) {}

export class MusicIdentityProviderRejected extends Schema.TaggedError<MusicIdentityProviderRejected>()(
  'MusicIdentityProviderRejected',
  {
    provider: Schema.String,
    reason: Schema.Literals(['invalid_request', 'not_found']),
    message: Schema.String,
  },
) {}

export class MusicIdentityProviderUnavailable extends Schema.TaggedError<MusicIdentityProviderUnavailable>()(
  'MusicIdentityProviderUnavailable',
  { provider: Schema.String, statusCode: Schema.optional(Schema.Number), message: Schema.String },
) {}

export class MusicIdentityArtworkDeliveryFailed extends Schema.TaggedError<MusicIdentityArtworkDeliveryFailed>()(
  'MusicIdentityArtworkDeliveryFailed',
  {
    entityType: Schema.Literals(['artist', 'album', 'track', 'playlist']),
    entityId: Schema.String,
    operation: Schema.Literal('upload'),
    message: Schema.String,
  },
) {}

export class MusicIdentityStorageError extends Schema.TaggedError<MusicIdentityStorageError>()(
  'MusicIdentityStorageError',
  { operation: Schema.String, message: Schema.String },
) {}

export class MusicIdentityAuthorizationFailed extends Schema.TaggedError<MusicIdentityAuthorizationFailed>()(
  'MusicIdentityAuthorizationFailed',
  { reason: Schema.Literals(['denied', 'unavailable']) },
) {}

export type MusicIdentityError =
  | MusicSourceInvalid
  | MusicIdentityAuthorizationFailed
  | MusicIdentityBusy
  | MusicIdentityAliasCollision
  | MusicIdentityArtworkDeliveryFailed
  | MusicIdentityConflict
  | MusicIdentityEntityNotFound
  | MusicIdentitySourceLinkNotFound
  | MusicIdentityInvalidSnapshot
  | MusicIdentityProviderRejected
  | MusicIdentityProviderUnavailable
  | MusicIdentityStorageError
