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

  const bounded = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.timeoutOption(budget),
      Effect.flatMap((value) =>
        Option.isSome(value) ? Effect.succeed(value.value) : Effect.fail(unavailable()),
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
        const req = yield* leasedRequest()

        const moved = yield* Effect.tryPromise({
          try: () => store.transition({ ...req, lease, transition: next }),
          catch: unavailable,
        })

        if (moved.status !== 'ready') return yield* unavailable()

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
            yield* input.checkpoint(type)

            const metadata = yield* bounded(
              s3.getObjectMetadata(stage.artifact.objectKey, config.buckets.userContent),
            )

            if (metadata && metadata.size !== stage.artifact.byteLength) return yield* unavailable()
            objectExists = metadata !== null
          }

          if (!objectExists) {
            const row = yield* Effect.tryPromise({
              try: () =>
                db.get(
                  sql`SELECT ${column} AS url, revision FROM ${table} WHERE id = ${stage.original.entityId}`,
                ),
              catch: unavailable,
            })

            const target = yield* Schema.decodeUnknownEffect(
              Schema.Struct({ url: Schema.NullOr(Schema.String), revision: Schema.Number }),
            )(row).pipe(Effect.mapError(unavailable))

            if (target.revision !== stage.original.catalogueRevision) {
              stage = yield* transition({ phase: 'failed', failureCode: 'stale_revision' })

              return undefined
            }

            if (!target.url) {
              stage = yield* transition({ phase: 'failed', failureCode: 'source_unavailable' })

              return undefined
            }

            yield* input.checkpoint(type)

            const image = yield* bounded(
              fetchImportMusicArtwork(
                fetcher,
                target.url,
                new URL(
                  `${config.urls.bucketRouter}/user-content/music/${type}/${stage.original.entityId}/`,
                ),
              ),
            )

            if (!image) {
              stage = yield* transition({ phase: 'failed', failureCode: 'artifact_rejected' })

              return undefined
            }

            const digest = yield* Effect.tryPromise({
              try: () => crypto.subtle.digest('SHA-256', image.bytes),
              catch: unavailable,
            })

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
            yield* input.checkpoint(type)
            yield* bounded(
              s3.uploadFile(
                stage.artifact.objectKey,
                image.bytes,
                image.contentType,
                config.buckets.userContent,
              ),
            )
          }

          stage = yield* transition({ phase: 'association_pending' })
        }

        if (stage.phase === 'association_pending' && stage.artifact) {
          const artifact = stage.artifact
          const req = yield* leasedRequest()

          const observed = yield* Effect.tryPromise({
            try: () =>
              db.get(sql`SELECT revision FROM ${table} WHERE id = ${stage.original.entityId}`),
            catch: unavailable,
          })

          const current = yield* Schema.decodeUnknownEffect(
            Schema.Struct({ revision: Schema.Number }),
          )(observed).pipe(Effect.mapError(unavailable))

          if (current.revision !== stage.original.catalogueRevision) {
            stage = yield* transition({ phase: 'failed', failureCode: 'stale_revision' })

            return undefined
          }

          const associated = yield* Effect.tryPromise({
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
          })

          if (associated.status !== 'ready') return yield* unavailable()
          stage = associated.stage
        }

        return undefined
      })

      const heartbeat = Effect.gen(function* () {
        const req = yield* leasedRequest()

        const renewed = yield* Effect.tryPromise({
          try: () => store.renew({ ...req, lease }),
          catch: unavailable,
        })

        if (renewed.status !== 'ready') return yield* unavailable()

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
