import { asc, desc, eq, sql } from 'drizzle-orm'
import { Effect, Predicate, Schema } from 'effect'

import { projectEntityLabels, projectEntityLabelsForRows } from '@/db/labels'
import { Database } from '@/db/layer'
import { musicArtistsTable, type SelectMusicArtist } from '@/db/music-entity.schema'
import { DatabaseError, getErrorMessage } from '@/errors'
import { omitUndefined } from '@/lib/omit-undefined'
import { toSlug } from '@/services/to-slug'

import { insertMusicEntity } from './create-statements'
import { deleteMusicEntity } from './delete-write'
import {
  artistNameFanoutCapacity,
  artistNameFanoutStatements,
  artistPrimaryNameAvailable,
  musicLabelReplacementStatements,
  musicParentCas,
  musicParentWinner,
} from './guarded-statements'
import { requireInserted, requireOne } from './shared'
import { executeMusicWrite, MusicWriteError, type MusicWriteRequest } from './write-intent'

export interface CreateArtistInput {
  name: string
  bio?: string | null
  imageUrl?: string | null
  genres?: Array<string> | null
  slug: string
  publishedAt?: Date | null
  createdById?: string | null
}

export const createArtistEffect = Effect.fn('musicEntity.createArtist')(function* (
  data: CreateArtistInput,
) {
  const db = yield* Database
  const id = crypto.randomUUID()

  const rows = yield* Effect.tryPromise({
    try: async () => {
      await insertMusicEntity(db, { entityType: 'artist', data }, id)

      return db.select().from(musicArtistsTable).where(eq(musicArtistsTable.id, id)).limit(1)
    },
    catch: (e) =>
      new DatabaseError({
        message: `Failed to create artist: ${getErrorMessage(e)}`,
        operation: 'insert',
        table: 'music_artists',
      }),
  })

  const artist = yield* requireInserted(rows, 'music_artists')

  const { genres: projectedGenres } = yield* Effect.tryPromise({
    try: () => projectEntityLabels(db, 'artist', artist),
    catch: (e) =>
      new DatabaseError({ message: getErrorMessage(e), operation: 'select', table: 'labels' }),
  })

  return { ...artist, genres: projectedGenres }
})

export const getArtistsEffect = Effect.gen(function* () {
  const db = yield* Database

  return yield* Effect.tryPromise({
    try: async () => {
      const artists = await db
        .select()
        .from(musicArtistsTable)
        .orderBy(desc(musicArtistsTable.createdAt), asc(musicArtistsTable.id))

      const projected = await projectEntityLabelsForRows(db, 'artist', artists)

      return projected.map(({ tags: _tags, genres, ...artist }) => ({ ...artist, genres }))
    },
    catch: (e) =>
      new DatabaseError({
        message: `Failed to list artists: ${getErrorMessage(e)}`,
        operation: 'select',
        table: 'music_artists',
      }),
  })
}).pipe(Effect.withSpan('musicEntity.getArtists'))

export const getArtistByIdEffect = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Database

    const rows = yield* Effect.tryPromise({
      try: () => db.select().from(musicArtistsTable).where(eq(musicArtistsTable.id, id)).limit(1),
      catch: (e) =>
        new DatabaseError({
          message: `Failed to get artist: ${getErrorMessage(e)}`,
          operation: 'select',
          table: 'music_artists',
        }),
    })

    const artist = yield* requireOne(rows, 'MusicArtist', id)

    const { genres } = yield* Effect.tryPromise({
      try: () => projectEntityLabels(db, 'artist', artist),
      catch: (e) =>
        new DatabaseError({ message: getErrorMessage(e), operation: 'select', table: 'labels' }),
    })

    return { ...artist, genres }
  }).pipe(Effect.withSpan('musicEntity.getArtistById', { attributes: { id } }))

const ArtistWriteRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  bio: Schema.NullOr(Schema.String),
  imageUrl: Schema.NullOr(Schema.String),
  slug: Schema.String,
  publishedAt: Schema.NullOr(Schema.DateFromString),
  createdById: Schema.NullOr(Schema.String),
  createdAt: Schema.DateFromString,
  updatedAt: Schema.DateFromString,
  revision: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
  lastOperationId: Schema.NullOr(Schema.String),
  genres: Schema.NullOr(Schema.Array(Schema.String)),
})

const ArtistWritePatch = Schema.Struct({
  name: Schema.optionalKey(ArtistWriteRow.fields.name),
  bio: Schema.optionalKey(ArtistWriteRow.fields.bio),
  imageUrl: Schema.optionalKey(ArtistWriteRow.fields.imageUrl),
  slug: Schema.optionalKey(ArtistWriteRow.fields.slug),
  publishedAt: Schema.optionalKey(ArtistWriteRow.fields.publishedAt),
  createdById: Schema.optionalKey(ArtistWriteRow.fields.createdById),
  genres: Schema.optionalKey(ArtistWriteRow.fields.genres),
})

export const updateArtistEffect = (
  id: string,
  data: Partial<CreateArtistInput>,
  write?: MusicWriteRequest,
) =>
  Effect.gen(function* () {
    if (!write)
      return yield* new MusicWriteError({
        code: 'precondition_required',
        message: 'An observed revision and request ID are required.',
      })

    const normalizedPatch = omitUndefined(data)

    if (data.genres !== undefined)
      normalizedPatch.genres = data.genres?.length ? [...new Set(data.genres)] : null

    const normalizedInput = yield* Schema.encodeEffect(ArtistWritePatch)(normalizedPatch).pipe(
      Effect.mapError(
        () => new MusicWriteError({ code: 'invalid_input', message: 'Invalid artist edit.' }),
      ),
    )

    const target = { entityType: 'artist', entityId: id } as const

    const result = yield* executeMusicWrite(write.intent, write.context, {
      operation: 'update_music_artist',
      target,
      disclosure: 'existing',
      normalizedInput,
      prepare: Effect.gen(function* () {
        // Slugs include randomness: allocate only after the shared replay lookup,
        // never as part of the normalized request digest.
        const patch = { ...normalizedPatch }

        if (patch.name && !patch.slug) patch.slug = toSlug(patch.name)

        const encodedPatch = yield* Schema.encodeEffect(ArtistWritePatch)(patch).pipe(
          Effect.mapError(
            () => new MusicWriteError({ code: 'invalid_input', message: 'Invalid artist edit.' }),
          ),
        )

        const before = yield* getArtistByIdEffect(id).pipe(
          Effect.mapError(
            (error) =>
              new MusicWriteError({
                code: Predicate.isTagged(error, 'NotFoundError') ? 'not_found' : 'unavailable',
                message: 'Artist write preparation failed.',
              }),
          ),
        )

        const encodedBefore: Readonly<Record<string, Schema.Json>> = yield* Schema.encodeEffect(
          ArtistWriteRow,
        )(before).pipe(
          Effect.mapError(
            () =>
              new MusicWriteError({ code: 'unavailable', message: 'Artist state is unavailable.' }),
          ),
        )

        const changed = Object.entries(encodedPatch).some(
          ([key, value]) => JSON.stringify(value) !== JSON.stringify(encodedBefore[key]),
        )

        if (
          before.revision !== write.intent.expectedRevision ||
          (changed && before.revision === Number.MAX_SAFE_INTEGER)
        )
          return yield* new MusicWriteError({
            code: 'conflict',
            message: 'Artist revision changed.',
          })

        const nameChanged = patch.name !== undefined && patch.name !== before.name

        return {
          build: (attempt) => {
            const winner = sql`(${attempt.fence}) AND (${attempt.liveGuard}) AND (${musicParentWinner(target, attempt.attemptId)})`

            const { genres: _genres, publishedAt: _publishedAt, ...metadata } = encodedPatch

            const assignments = Object.entries(metadata).map(
              ([key, value]) => sql`${sql.identifier(key)}=${value}`,
            )

            if (patch.publishedAt !== undefined)
              assignments.push(sql`publishedAt=${patch.publishedAt?.getTime() ?? null}`)

            if (changed) assignments.push(sql`updatedAt=${write.context.now}`)

            const after = Schema.encodeSync(ArtistWriteRow)({
              ...before,
              ...patch,
              revision: before.revision + (changed ? 1 : 0),
              updatedAt: changed ? new Date(write.context.now) : before.updatedAt,
              lastOperationId: attempt.attemptId,
            })

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
                    eligibility: nameChanged
                      ? sql`(${artistPrimaryNameAvailable(id, patch.name ?? before.name)}) AND (${artistNameFanoutCapacity(id)})`
                      : sql`1`,
                  }),
                ),
                ...(changed && patch.genres !== undefined
                  ? musicLabelReplacementStatements({
                      target,
                      kind: 'genre',
                      names: patch.genres ?? [],
                      winner,
                      prepare: attempt.prepare,
                    })
                  : []),
                ...(nameChanged
                  ? artistNameFanoutStatements({
                      artistId: id,
                      attemptId: attempt.attemptId,
                      fence: sql`(${attempt.fence}) AND (${attempt.liveGuard})`,
                      prepare: attempt.prepare,
                    })
                  : []),
              ],
              assertApplied: winner,
              outcome: {
                result: after,
                revision: { ...target, revision: after.revision },
                access: target,
              },
            }
          },
        }
      }),
    })

    const saved = yield* Schema.decodeUnknownEffect(ArtistWriteRow)(result.outcome.result).pipe(
      Effect.mapError(
        () =>
          new MusicWriteError({ code: 'unavailable', message: 'Artist result is unavailable.' }),
      ),
    )

    return { ...saved, genres: saved.genres?.slice() ?? null }
  }).pipe(Effect.withSpan('musicEntity.updateArtist', { attributes: { id } }))

export const deleteArtistEffect = (id: string, write?: MusicWriteRequest) =>
  deleteMusicEntity({ entityType: 'artist', entityId: id }, write)

const findArtistByNameCI = (name: string) =>
  Effect.gen(function* () {
    const db = yield* Database

    return yield* Effect.tryPromise({
      try: () =>
        db
          .select()
          .from(musicArtistsTable)
          .where(sql`lower(${musicArtistsTable.name}) = lower(${name})`)
          .limit(1),
      catch: (e) =>
        new DatabaseError({
          message: `Failed to find artist: ${getErrorMessage(e)}`,
          operation: 'select',
          table: 'music_artists',
        }),
    })
  }).pipe(Effect.withSpan('musicEntity.findArtistByNameCI'))

export const findOrCreateArtist = Effect.fn('musicEntity.findOrCreateArtist')(function* (
  name: string,
  opts?: { imageUrl?: string | null },
) {
  const db = yield* Database
  const rows = yield* findArtistByNameCI(name)
  const existing = rows[0]

  if (existing) {
    if (opts?.imageUrl && existing.imageUrl !== opts.imageUrl) {
      yield* Effect.logInfo(
        `[MusicEntity] Artist "${existing.name}" exists with different imageUrl (existing: ${existing.imageUrl}, scraped: ${opts.imageUrl}) — skipping update`,
      )
    }

    const { genres } = yield* Effect.tryPromise({
      try: () => projectEntityLabels(db, 'artist', existing),
      catch: (e) =>
        new DatabaseError({ message: getErrorMessage(e), operation: 'select', table: 'labels' }),
    })

    return { ...existing, genres }
  }

  return yield* createArtistEffect(
    omitUndefined({
      name,
      slug: toSlug(name),
      imageUrl: opts?.imageUrl,
    }),
  )
})

export const findOrCreateArtistsByName = Effect.fn('musicEntity.findOrCreateArtistsByName')(
  function* (names: Array<string>) {
    const artists: Array<SelectMusicArtist> = []

    for (const name of names) {
      artists.push(yield* findOrCreateArtist(name))
    }

    return artists
  },
)
