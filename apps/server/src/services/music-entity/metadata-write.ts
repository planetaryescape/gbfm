import { sql } from 'drizzle-orm'
import { Effect, Predicate, Result, Schema } from 'effect'

import type { Database } from '@/db/layer'
import type { DatabaseError, NotFoundError } from '@/errors'
import { toSlug } from '@/services/to-slug'

import {
  type MusicParent,
  musicLabelReplacementStatements,
  musicParentCas,
  musicParentWinner,
} from './guarded-statements'
import { prepareMusicRelationships } from './relationship-write'
import {
  executeMusicWrite,
  MusicWriteError,
  MusicWriteIntent,
  type MusicWriteRequest,
} from './write-intent'

export const MusicMetadataRow = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  publishedAt: Schema.NullOr(Schema.DateFromString),
  createdById: Schema.NullOr(Schema.String),
  createdAt: Schema.DateFromString,
  updatedAt: Schema.DateFromString,
  revision: MusicWriteIntent.fields.expectedRevision,
  lastOperationId: Schema.NullOr(Schema.String),
})

interface MetadataRow {
  readonly revision: number
  readonly updatedAt: Date
}

/** Browser metadata owns its wider scalar fields; MCP allowlists stay separate.
 * The row codec preserves dates and the original complete result in the common
 * receipt. Relationship observations and random slugs happen only on a miss.
 */
export const writeMusicMetadata = Effect.fn('musicEntity.writeMetadata')(function* <
  Row extends MetadataRow,
  Encoded extends Readonly<Record<string, Schema.Json>>,
>(input: {
  readonly target: MusicParent
  readonly write: MusicWriteRequest | undefined
  readonly patch: Readonly<Record<string, Schema.Json>>
  readonly row: Schema.Codec<Row, Encoded>
  readonly load: Effect.Effect<Row, DatabaseError | NotFoundError, Database>
  readonly relationships?:
    | {
        readonly artistIds?: ReadonlyArray<string> | undefined
        readonly artistNames?: ReadonlyArray<string> | null | undefined
        readonly albumId?: string | null | undefined
      }
    | undefined
  readonly validate?: Effect.Effect<void, MusicWriteError> | undefined
}) {
  const { target, write } = input

  if (!write)
    return yield* new MusicWriteError({
      code: 'precondition_required',
      message: 'An observed revision and request ID are required.',
    })

  const normalizedPatch = { ...input.patch }

  for (const key of ['genres', 'tags'] as const) {
    if (normalizedPatch[key] === undefined) continue

    const names = yield* Schema.decodeUnknownEffect(Schema.NullOr(Schema.Array(Schema.String)))(
      normalizedPatch[key],
    ).pipe(
      Effect.mapError(
        () => new MusicWriteError({ code: 'invalid_input', message: 'Invalid music labels.' }),
      ),
    )

    normalizedPatch[key] = names?.length ? [...new Set(names)] : null
  }

  const result = yield* executeMusicWrite(write.intent, write.context, {
    operation: `update_music_${target.entityType}`,
    target,
    disclosure: 'existing',
    normalizedInput: {
      patch: normalizedPatch,
      artistIds: input.relationships?.artistIds ?? null,
      references: write.references.map((reference) => ({ ...reference })),
    },
    prepare: Effect.gen(function* () {
      if (input.validate) yield* input.validate

      const before = yield* input.load.pipe(
        Effect.mapError(
          (error) =>
            new MusicWriteError({
              code: Predicate.isTagged(error, 'NotFoundError') ? 'not_found' : 'unavailable',
              message: 'Music metadata preparation failed.',
            }),
        ),
      )

      const encodedBefore = yield* Schema.encodeEffect(input.row)(before).pipe(
        Effect.mapError(
          () =>
            new MusicWriteError({
              code: 'unavailable',
              message: 'Music metadata state unavailable.',
            }),
        ),
      )

      const relationships = yield* prepareMusicRelationships(
        target,
        input.relationships ?? {},
        write,
      )

      const patch = { ...normalizedPatch, ...relationships.patch }
      const titleField = target.entityType === 'label' ? 'name' : 'title'
      const title = Schema.decodeUnknownResult(Schema.String)(patch[titleField])

      if (Result.isSuccess(title) && title.success !== encodedBefore[titleField] && !patch.slug)
        patch.slug = toSlug(title.success)

      const changed =
        relationships.changed ||
        Object.entries(patch).some(
          ([key, value]) => JSON.stringify(value) !== JSON.stringify(encodedBefore[key]),
        )

      if (
        before.revision !== write.intent.expectedRevision ||
        (changed && before.revision === Number.MAX_SAFE_INTEGER)
      )
        return yield* new MusicWriteError({ code: 'conflict', message: 'Music revision changed.' })

      return {
        build: (attempt) => {
          const winner = sql`(${attempt.fence}) AND (${attempt.liveGuard}) AND (${musicParentWinner(target, attempt.attemptId)})`

          const labelColumns = new Map([
            ['imageUrl', 'image_url'],
            ['bannerImageUrl', 'banner_image_url'],
            ['publishedAt', 'published_at'],
            ['createdById', 'created_by_id'],
          ])

          const assignments = Object.entries(patch).flatMap(([key, value]) => {
            if (key === 'genres' || key === 'tags') return []

            const column = sql.identifier(
              target.entityType === 'label' ? (labelColumns.get(key) ?? key) : key,
            )

            if ((key === 'publishedAt' || key === 'releaseDate') && value !== null)
              return [
                sql`${column}=${Schema.decodeUnknownSync(Schema.DateFromString)(value).getTime()}`,
              ]

            return [sql`${column}=${Array.isArray(value) ? JSON.stringify(value) : value}`]
          })

          if (changed)
            assignments.push(
              sql`${sql.identifier(target.entityType === 'label' ? 'updated_at' : 'updatedAt')}=${write.context.now}`,
            )

          const after = {
            ...encodedBefore,
            ...patch,
            revision: before.revision + (changed ? 1 : 0),
            updatedAt: changed
              ? new Date(write.context.now).toISOString()
              : before.updatedAt.toISOString(),
            lastOperationId: attempt.attemptId,
          }

          return {
            statements: [
              attempt.prepare(
                musicParentCas({
                  target,
                  expectedRevision: write.intent.expectedRevision,
                  changed,
                  attemptId: attempt.attemptId,
                  fence: attempt.fence,
                  liveGuard: attempt.liveGuard,
                  assignments,
                  eligibility: relationships.eligibility,
                }),
              ),
              ...relationships.statements(attempt.prepare, winner),
              ...(['genres', 'tags'] as const).flatMap((key) => {
                const names = patch[key]

                return changed && names !== undefined
                  ? musicLabelReplacementStatements({
                      target,
                      kind: key === 'genres' ? 'genre' : 'tag',
                      names:
                        Schema.decodeUnknownSync(Schema.NullOr(Schema.Array(Schema.String)))(
                          names,
                        ) ?? [],
                      prepare: attempt.prepare,
                      winner,
                    })
                  : []
              }),
            ],
            assertApplied: winner,
            outcome: {
              result: after,
              revision: { ...target, revision: after.revision },
              access: { ...target },
            },
          }
        },
      }
    }),
  })

  return yield* Schema.decodeUnknownEffect(input.row)(result.outcome.result).pipe(
    Effect.mapError(
      () => new MusicWriteError({ code: 'unavailable', message: 'Music result unavailable.' }),
    ),
  )
})
