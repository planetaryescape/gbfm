import { Effect, Match, Result, Schema } from 'effect'

import { McpToolError } from '@/mcp/contracts'
import type {
  AnyResolvedMusicEntity,
  MusicIdentityError,
} from '@/services/canonical-music-identity'

const reference = Schema.Struct({
  entityType: Schema.Literals(['artist', 'album', 'track', 'playlist']),
  entityId: Schema.NonEmptyString,
})

export const ImportPersistenceOutcome = Schema.Union([
  Schema.Struct({
    status: Schema.Literals(['created', 'reused']),
    reference,
    // The current resolver can silently skip an unavailable artwork fetch even
    // in required mode. Its success alone is NOT proof of artwork delivery.
    artwork: Schema.Literal('not_reported'),
  }),
  Schema.Struct({
    status: Schema.Literal('partial'),
    reference,
    disposition: Schema.Literal('unknown'),
    artwork: Schema.Literal('upload_failed'),
  }),
])

const failure = (code: McpToolError['code'], message: string) =>
  Effect.fail(new McpToolError({ code, message }))

// This projects one resolver attempt, not a durable command/replay result.
// Only the future approved atomic writer can persist the original disposition.
export const projectImportPersistence = (
  result: Result.Result<AnyResolvedMusicEntity, MusicIdentityError>,
): Effect.Effect<typeof ImportPersistenceOutcome.Type, McpToolError> => {
  if (Result.isSuccess(result)) {
    return Schema.decodeUnknownEffect(ImportPersistenceOutcome)({
      status: result.success.created ? 'created' : 'reused',
      reference: { entityType: result.success.entityType, entityId: result.success.entity.id },
      artwork: 'not_reported',
    }).pipe(
      Effect.mapError(
        () => new McpToolError({ code: 'unavailable', message: 'Invalid import outcome.' }),
      ),
    )
  }

  return Match.value(result.failure).pipe(
    Match.tag('MusicIdentityAuthorizationFailed', (error) =>
      failure(
        error.reason === 'denied' ? 'access_denied' : 'unavailable',
        'Music operation authorization failed.',
      ),
    ),
    Match.tag('MusicIdentityArtworkDeliveryFailed', (error) =>
      Effect.succeed({
        status: 'partial' as const,
        reference: { entityType: error.entityType, entityId: error.entityId },
        disposition: 'unknown' as const,
        artwork: 'upload_failed' as const,
      }),
    ),
    Match.tag('MusicSourceInvalid', 'MusicIdentityInvalidSnapshot', () =>
      failure('invalid_input', 'Invalid music source or provider result.'),
    ),
    Match.tag('MusicIdentityAliasCollision', 'MusicIdentityConflict', () =>
      failure(
        'conflict',
        'Music source identities conflict. Administrator reconciliation is required.',
      ),
    ),
    Match.tag('MusicIdentityEntityNotFound', 'MusicIdentitySourceLinkNotFound', () =>
      failure('not_found', 'Music entity or source link not found.'),
    ),
    Match.tag('MusicIdentityProviderRejected', (error) =>
      failure(
        error.reason === 'not_found' ? 'not_found' : 'invalid_input',
        'Music provider rejected the source.',
      ),
    ),
    Match.tag('MusicIdentityProviderUnavailable', () =>
      failure('unavailable', 'Music provider unavailable. Reconcile using the same requestId.'),
    ),
    Match.tag('MusicIdentityStorageError', () =>
      failure(
        'unavailable',
        'Music persistence outcome is unknown. Reconcile using the same requestId.',
      ),
    ),
    Match.tag('MusicIdentityBusy', (error) =>
      Effect.fail(
        new McpToolError({
          code: 'rate_limited',
          message: 'Music identity resolution is busy.',
          retryAfterSeconds: Math.max(1, Math.min(60, Math.ceil(error.retryAfterMs / 1000))),
        }),
      ),
    ),
    Match.exhaustive,
  )
}
