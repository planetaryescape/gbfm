import { sql } from 'drizzle-orm'
import { Clock, Context, Effect, Layer, Option, Result, Schedule, Schema } from 'effect'

import { Database } from '@/db/layer'
import type { CommandCheckpoint } from '@/mcp/command-authority'
import { McpToolError } from '@/mcp/contracts'
import {
  McpArtworkStore,
  type ArtworkStage,
  type ArtworkTransition,
} from '@/mcp/operations/staged-store'
import type { JsonValue, OperationKey } from '@/mcp/operations/store'
import {
  fetchImportMusicArtwork,
  ImportArtworkFetchUnavailable,
  MusicCoverImageFetcher,
} from '@/services/canonical-music-identity/artwork-delivery'
import type { CanonicalMusicEntityType } from '@/services/canonical-music-identity/music-source'
import { ConfigService } from '@/services/config.service'
import { S3Service } from '@/services/s3.service'

interface ImportArtworkRequest {
  readonly key: OperationKey
  readonly normalizedInput: JsonValue
  readonly sourceKey: string
  readonly checkpoint: (
    type?: CanonicalMusicEntityType,
  ) => Effect.Effect<CommandCheckpoint, McpToolError>
}

export const MusicImportIoBudget = Context.Reference<number>('gbfm/MusicImportIoBudget', {
  defaultValue: () => 12000,
})

const tables = { artist: 'music_artists', album: 'music_albums', track: 'music_tracks' }

interface ArtworkDiagnostic {
  readonly step:
    | 'target_read'
    | 'source_fetch'
    | 'artifact_digest'
    | 'transition'
    | 'object_head'
    | 'object_upload'
    | 'association'
    | 'heartbeat'
    | 'checkpoint'
  readonly dependency: 'database' | 'provider' | 'storage' | 'authorization' | 'crypto'
  readonly reason:
    | 'timeout'
    | 'network'
    | 'provider_status'
    | 'body_read'
    | 'target_read'
    | 'transition'
    | 'storage'
    | 'other'
}

const unavailable = () =>
  new McpToolError({
    code: 'unavailable',
    message: 'Artwork remains recoverable. Retry identical import input and requestId.',
  })

const makeArtwork = Effect.gen(function* () {
  const db = yield* Database
  const store = yield* McpArtworkStore
  const s3 = yield* S3Service
  const config = yield* ConfigService
  const fetcher = yield* MusicCoverImageFetcher
  const budget = yield* MusicImportIoBudget

  const report = (diagnostic: ArtworkDiagnostic) =>
    Effect.logWarning('mcp.music_import.artwork.recoverable').pipe(
      Effect.annotateLogs({ ...diagnostic }),
    )

  const observed = <A, E, R>(effect: Effect.Effect<A, E, R>, diagnostic: ArtworkDiagnostic) =>
    effect.pipe(
      Effect.tapError((error) =>
        error instanceof McpToolError && error.code === 'access_denied'
          ? Effect.void
          : report({
              ...diagnostic,
              reason:
                error instanceof ImportArtworkFetchUnavailable ? error.reason : diagnostic.reason,
            }),
      ),
    )

  const bounded = <A, E, R>(effect: Effect.Effect<A, E, R>, diagnostic: ArtworkDiagnostic) =>
    observed(effect, diagnostic).pipe(
      Effect.timeoutOption(budget),
      Effect.flatMap((value) =>
        Option.isSome(value)
          ? Effect.succeed(value.value)
          : report({ ...diagnostic, reason: 'timeout' }).pipe(
              Effect.andThen(Effect.fail(unavailable())),
            ),
      ),
      Effect.mapError(unavailable),
    )

  const request = Effect.fn('MusicImportArtwork.request')(function* (input: ImportArtworkRequest) {
    const services = yield* Effect.context()
    const checkpoint = yield* input.checkpoint()

    return {
      key: input.key,
      normalizedInput: input.normalizedInput,
      now: yield* Clock.currentTimeMillis,
      liveGuard: checkpoint.liveGuard,
      authorize: async (stage?: ArtworkStage) => {
        if (
          stage &&
          (stage.sourceIdentityKey !== input.sourceKey ||
            stage.original.entityType === 'playlist' ||
            stage.original.entityType === 'label')
        )
          return false

        const current = await Effect.runPromiseWith(services)(
          input
            .checkpoint(
              stage?.original.entityType === 'label' ? undefined : stage?.original.entityType,
            )
            .pipe(Effect.result),
        )

        if (Result.isFailure(current)) {
          if (current.failure.code === 'access_denied') return false
          throw new Error('Artwork authorization unavailable')
        }

        if (!stage) return true
        const type = stage.original.entityType

        if (type === 'playlist' || type === 'label') return false

        return Boolean(
          await db.get(
            sql`SELECT 1 FROM ${sql.identifier(tables[type])} WHERE id = ${stage.original.entityId} AND (${current.success.liveGuard}) AND EXISTS (SELECT 1 FROM music_source_identities WHERE source_key = ${input.sourceKey} AND state = 'resolved' AND entity_type = ${type} AND entity_id = ${stage.original.entityId})`,
          ),
        )
      },
    }
  })

  const inspect = Effect.fn('MusicImportArtwork.inspect')(function* (input: ImportArtworkRequest) {
    const req = yield* request(input)

    return yield* Effect.tryPromise({ try: () => store.read(req), catch: unavailable })
  })

  const run = Effect.fn('MusicImportArtwork.run')(function* (
    input: ImportArtworkRequest,
    recover: boolean,
  ) {
    const initial = yield* request(input)

    let result = yield* Effect.tryPromise({
      try: () => (recover ? store.acquire(initial) : store.read(initial)),
      catch: unavailable,
    })

    if (result.status === 'busy') {
      result = yield* inspect(input)
    }

    if (result.status !== 'ready' && result.status !== 'leased') return yield* unavailable()

    if (result.status === 'leased') {
      const lease = result.lease
      let stage = result.stage

      const leasedRequest = () =>
        request(input).pipe(
          Effect.map((req) => ({
            ...req,
            liveGuard: sql`(${req.liveGuard}) AND EXISTS (SELECT 1 FROM mcp_operation_artwork a
          JOIN music_source_identities i ON i.source_key = a.source_identity_key AND i.entity_type = a.entity_type AND i.entity_id = a.entity_id AND i.state = 'resolved'
          WHERE a.operation_id = ${stage.operationId} AND a.lease_attempt_id = ${lease.attemptId} AND a.lease_generation = ${lease.generation}
            AND a.lease_expires_at > CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))`,
          })),
        )

      const transition = Effect.fn('MusicImportArtwork.transition')(function* (
        next: ArtworkTransition,
      ) {
        const req = yield* observed(leasedRequest(), {
          step: 'checkpoint',
          dependency: 'authorization',
          reason: 'other',
        })

        const moved = yield* observed(
          Effect.tryPromise({
            try: () => store.transition({ ...req, lease, transition: next }),
            catch: unavailable,
          }),
          {
            step: 'transition',
            dependency: 'database',
            reason: 'transition',
          },
        )

        if (moved.status !== 'ready') {
          if (moved.status !== 'access_denied')
            yield* report({ step: 'transition', dependency: 'database', reason: 'transition' })

          return yield* unavailable()
        }

        return moved.stage
      })

      const work = Effect.gen(function* () {
        const type = stage.original.entityType

        if (type === 'playlist' || type === 'label') return yield* unavailable()
        const table = sql.identifier(tables[type])
        const column = sql.identifier(type === 'artist' ? 'imageUrl' : 'coverImageUrl')

        if (stage.phase === 'pending' || stage.phase === 'uploading') {
          let objectExists = false

          if (stage.artifact) {
            yield* observed(input.checkpoint(type), {
              step: 'checkpoint',
              dependency: 'authorization',
              reason: 'other',
            })

            const metadata = yield* bounded(
              s3.getObjectMetadata(stage.artifact.objectKey, config.buckets.userContent),
              { step: 'object_head', dependency: 'storage', reason: 'storage' },
            )

            if (metadata && metadata.size !== stage.artifact.byteLength) return yield* unavailable()
            objectExists = metadata !== null
          }

          if (!objectExists) {
            const row = yield* observed(
              Effect.tryPromise({
                try: () =>
                  db.get(
                    sql`SELECT ${column} AS url, revision FROM ${table} WHERE id = ${stage.original.entityId}`,
                  ),
                catch: unavailable,
              }),
              { step: 'target_read', dependency: 'database', reason: 'target_read' },
            )

            const target = yield* observed(
              Schema.decodeUnknownEffect(
                Schema.Struct({ url: Schema.NullOr(Schema.String), revision: Schema.Number }),
              )(row).pipe(Effect.mapError(unavailable)),
              { step: 'target_read', dependency: 'database', reason: 'target_read' },
            )

            if (target.revision !== stage.original.catalogueRevision) {
              stage = yield* transition({ phase: 'failed', failureCode: 'stale_revision' })

              return undefined
            }

            if (!target.url) {
              stage = yield* transition({ phase: 'failed', failureCode: 'source_unavailable' })

              return undefined
            }

            yield* observed(input.checkpoint(type), {
              step: 'checkpoint',
              dependency: 'authorization',
              reason: 'other',
            })

            const image = yield* bounded(
              fetchImportMusicArtwork(
                fetcher,
                target.url,
                new URL(
                  `${config.urls.bucketRouter}/user-content/music/${type}/${stage.original.entityId}/`,
                ),
              ),
              { step: 'source_fetch', dependency: 'provider', reason: 'other' },
            )

            if (!image) {
              stage = yield* transition({ phase: 'failed', failureCode: 'artifact_rejected' })

              return undefined
            }

            const digest = yield* observed(
              Effect.tryPromise({
                try: () => crypto.subtle.digest('SHA-256', image.bytes),
                catch: unavailable,
              }),
              { step: 'artifact_digest', dependency: 'crypto', reason: 'other' },
            )

            const sha256 = Array.from(new Uint8Array(digest), (byte) =>
              byte.toString(16).padStart(2, '0'),
            ).join('')

            if (
              stage.artifact &&
              (stage.artifact.sha256 !== sha256 ||
                stage.artifact.contentType !== image.contentType ||
                stage.artifact.byteLength !== image.bytes.byteLength)
            ) {
              stage = yield* transition({ phase: 'failed', failureCode: 'artifact_rejected' })

              return undefined
            }

            stage = yield* transition({
              phase: 'uploading',
              artifact: {
                sha256,
                contentType: image.contentType,
                byteLength: image.bytes.byteLength,
              },
            })

            if (!stage.artifact) return yield* unavailable()
            yield* observed(input.checkpoint(type), {
              step: 'checkpoint',
              dependency: 'authorization',
              reason: 'other',
            })
            yield* bounded(
              s3.uploadFile(
                stage.artifact.objectKey,
                image.bytes,
                image.contentType,
                config.buckets.userContent,
              ),
              { step: 'object_upload', dependency: 'storage', reason: 'storage' },
            )
          }

          stage = yield* transition({ phase: 'association_pending' })
        }

        if (stage.phase === 'association_pending' && stage.artifact) {
          const artifact = stage.artifact

          const req = yield* observed(leasedRequest(), {
            step: 'checkpoint',
            dependency: 'authorization',
            reason: 'other',
          })

          const row = yield* observed(
            Effect.tryPromise({
              try: () =>
                db.get(sql`SELECT revision FROM ${table} WHERE id = ${stage.original.entityId}`),
              catch: unavailable,
            }),
            { step: 'target_read', dependency: 'database', reason: 'target_read' },
          )

          const current = yield* observed(
            Schema.decodeUnknownEffect(Schema.Struct({ revision: Schema.Number }))(row).pipe(
              Effect.mapError(unavailable),
            ),
            { step: 'target_read', dependency: 'database', reason: 'target_read' },
          )

          if (current.revision !== stage.original.catalogueRevision) {
            stage = yield* transition({ phase: 'failed', failureCode: 'stale_revision' })

            return undefined
          }

          const associated = yield* observed(
            Effect.tryPromise({
              try: () =>
                store.associate({
                  ...req,
                  lease,
                  build: (context) => {
                    const url = `${config.urls.bucketRouter}/user-content/${artifact.objectKey}`
                    const target = stage.original
                    const sourceGuard = sql`EXISTS (SELECT 1 FROM music_source_identities WHERE source_key = ${input.sourceKey} AND state = 'resolved' AND entity_type = ${type} AND entity_id = ${target.entityId})`

                    return {
                      statements: [
                        context.prepare(
                          sql`UPDATE ${table} SET ${column} = ${url}, revision = revision + 1, last_operation_id = ${context.attemptId}, updatedAt = ${req.now} WHERE id = ${target.entityId} AND revision = ${target.catalogueRevision} AND (${context.fence}) AND (${req.liveGuard}) AND (${sourceGuard})`,
                        ),
                      ],
                      assertApplied: sql`(${sourceGuard}) AND EXISTS (SELECT 1 FROM ${table} WHERE id = ${target.entityId} AND revision = ${target.catalogueRevision + 1} AND last_operation_id = ${context.attemptId} AND ${column} = ${url})`,
                    }
                  },
                }),
              catch: unavailable,
            }),
            { step: 'association', dependency: 'database', reason: 'storage' },
          )

          if (associated.status !== 'ready') {
            if (associated.status !== 'access_denied')
              yield* report({ step: 'association', dependency: 'database', reason: 'storage' })

            return yield* unavailable()
          }

          stage = associated.stage
        }

        return undefined
      })

      const heartbeat = Effect.gen(function* () {
        const req = yield* observed(leasedRequest(), {
          step: 'heartbeat',
          dependency: 'authorization',
          reason: 'other',
        })

        const renewed = yield* observed(
          Effect.tryPromise({
            try: () => store.renew({ ...req, lease }),
            catch: unavailable,
          }),
          { step: 'heartbeat', dependency: 'database', reason: 'storage' },
        )

        if (renewed.status !== 'ready') {
          if (renewed.status !== 'access_denied')
            yield* report({ step: 'heartbeat', dependency: 'database', reason: 'storage' })

          return yield* unavailable()
        }

        return undefined
      }).pipe(Effect.repeat(Schedule.spaced('20 seconds')), Effect.delay('20 seconds'))

      yield* work.pipe(
        Effect.raceFirst(heartbeat),
        Effect.catchTag('McpToolError', (error) =>
          error.code === 'access_denied' ? Effect.fail(error) : Effect.void,
        ),
      )

      if (stage.phase === 'delivered' || stage.phase === 'failed')
        return {
          phase: stage.phase,
          associatedRevision: stage.associatedRevision,
          failureCode: stage.failureCode,
        }
      const latest = yield* inspect(input)

      if (latest.status !== 'ready') return yield* unavailable()
      stage = latest.stage

      return {
        phase: stage.phase,
        associatedRevision: stage.associatedRevision,
        failureCode: stage.failureCode,
      }
    }

    return {
      phase: result.stage.phase,
      associatedRevision: result.stage.associatedRevision,
      failureCode: result.stage.failureCode,
    }
  })

  return { inspect, run }
})

export class MusicImportArtwork extends Context.Service<
  MusicImportArtwork,
  Effect.Success<typeof makeArtwork>
>()('gbfm/mcp/MusicImportArtwork') {}

export const MusicImportArtworkLayer = Layer.effect(MusicImportArtwork, makeArtwork)
