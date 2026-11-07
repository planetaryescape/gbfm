import type { D1PreparedStatement } from '@cloudflare/workers-types'
import { type SQL, sql } from 'drizzle-orm'
import { Effect, Schema } from 'effect'

import { Database } from '@/db/layer'

import {
  type MusicParent,
  musicParentCas,
  musicParentGuard,
  musicParentWinner,
} from './guarded-statements'
import {
  executeMusicWrite,
  MusicWriteError,
  MusicWriteIntent,
  type MusicWriteRequest,
} from './write-intent'

const tables = {
  artist: 'music_artists',
  album: 'music_albums',
  track: 'music_tracks',
  label: 'music_labels',
} as const

const unavailable = () =>
  new MusicWriteError({ code: 'unavailable', message: 'Music relationship state unavailable.' })

/** Resolve only caller-pinned observations, never substitute freshly read versions.
 * The returned SQL repeats every observation in the eventual physical root CAS.
 */
export const observeMusicReferences = Effect.fn('musicEntity.observeReferences')(function* (
  required: ReadonlyArray<MusicParent>,
  write: MusicWriteRequest,
) {
  const keys = new Set(required.map((reference) => `${reference.entityType}:${reference.entityId}`))

  const suppliedKeys = write.references.map(
    (reference) => `${reference.entityType}:${reference.entityId}`,
  )

  if (
    keys.size !== suppliedKeys.length ||
    new Set(suppliedKeys).size !== suppliedKeys.length ||
    suppliedKeys.some((key) => !keys.has(key))
  )
    return yield* new MusicWriteError({
      code: 'invalid_input',
      message: 'Exact observed references are required.',
    })

  const db = yield* Database
  const guards: Array<SQL> = []
  const names = new Map<string, string>()

  for (const reference of write.references) {
    const revision = yield* Schema.decodeUnknownEffect(MusicWriteIntent.fields.expectedRevision)(
      reference.expectedRevision,
    ).pipe(
      Effect.mapError(
        () =>
          new MusicWriteError({ code: 'invalid_input', message: 'Invalid reference revision.' }),
      ),
    )

    const row = yield* Effect.tryPromise({
      try: () =>
        db.get(sql`SELECT revision, ${reference.entityType === 'artist' ? sql`name` : sql`NULL`} AS name
        FROM ${sql.identifier(tables[reference.entityType])} WHERE id=${reference.entityId}`),
      catch: unavailable,
    })

    if (!row)
      return yield* new MusicWriteError({
        code: 'not_found',
        message: 'Music reference not found.',
      })

    const observed = yield* Schema.decodeUnknownEffect(
      Schema.Struct({
        revision: MusicWriteIntent.fields.expectedRevision,
        name: Schema.NullOr(Schema.String),
      }),
    )(row).pipe(Effect.mapError(unavailable))

    if (observed.revision !== revision)
      return yield* new MusicWriteError({ code: 'conflict', message: 'Music reference changed.' })

    if (observed.name !== null) names.set(reference.entityId, observed.name)
    guards.push(musicParentGuard(reference, revision))
  }

  return {
    eligibility: guards.length
      ? sql.join(
          guards.map((guard) => sql`(${guard})`),
          sql` AND `,
        )
      : sql`1`,
    names,
  }
})

const Credit = Schema.Struct({ artistId: Schema.String, name: Schema.String })

export interface MusicRelationshipPreparation {
  readonly patch: Readonly<Record<string, Schema.Json>>
  readonly changed: boolean
  readonly eligibility: SQL
  readonly statements: (
    prepare: (statement: SQL) => D1PreparedStatement,
    winner: SQL,
  ) => ReadonlyArray<D1PreparedStatement>
}

/** Browser ordered artistIds replace billing, not asserted recording facts.
 * Retained roles survive; an unchanged ordered set does not rewrite junctions.
 * Manual artistNames cannot contradict existing or newly submitted billing.
 */
export const prepareMusicRelationships = Effect.fn('musicEntity.prepareRelationships')(function* (
  target: MusicParent,
  input: {
    readonly artistIds?: ReadonlyArray<string> | undefined
    readonly artistNames?: ReadonlyArray<string> | null | undefined
    readonly albumId?: string | null | undefined
  },
  write: MusicWriteRequest,
) {
  const db = yield* Database
  const billed = target.entityType === 'album' || target.entityType === 'track'

  const junction = sql.identifier(
    target.entityType === 'album' ? 'music_album_artists' : 'music_track_artists',
  )

  const parent = sql.identifier(target.entityType === 'album' ? 'albumId' : 'trackId')

  const current =
    billed && (input.artistIds !== undefined || input.artistNames !== undefined)
      ? yield* Effect.tryPromise({
          try: () =>
            db.all(sql`SELECT c.artistId,a.name FROM ${junction} c JOIN music_artists a ON a.id=c.artistId
          WHERE c.${parent}=${target.entityId} ORDER BY c.displayOrder,c.artistId`),
          catch: unavailable,
        }).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Credit))),
          Effect.mapError(unavailable),
        )
      : []

  if (
    input.artistIds !== undefined &&
    (!billed || new Set(input.artistIds).size !== input.artistIds.length)
  )
    return yield* new MusicWriteError({
      code: 'invalid_input',
      message: 'Unique billing artists are required.',
    })

  const required: Array<MusicParent> = []

  if (input.artistIds !== undefined)
    for (const artistId of new Set([
      ...current.map((credit) => credit.artistId),
      ...input.artistIds,
    ]))
      required.push({ entityType: 'artist', entityId: artistId })

  if (input.albumId !== undefined && input.albumId !== null)
    required.push({ entityType: 'album', entityId: input.albumId })
  const references = yield* observeMusicReferences(required, write)
  const patch: Record<string, Schema.Json> = {}

  const desiredNames = yield* Schema.decodeUnknownEffect(Schema.Array(Schema.String))(
    input.artistIds?.map((artistId) => references.names.get(artistId)) ??
      current.map((credit) => credit.name),
  ).pipe(Effect.mapError(unavailable))

  if (
    (input.artistIds !== undefined || current.length > 0) &&
    input.artistNames !== undefined &&
    JSON.stringify(input.artistNames) !== JSON.stringify(desiredNames)
  )
    return yield* new MusicWriteError({
      code: 'invalid_input',
      message: 'Artist names must match observed billing.',
    })

  if (input.artistIds !== undefined) patch.artistNames = desiredNames

  const changed =
    input.artistIds !== undefined &&
    JSON.stringify(input.artistIds) !== JSON.stringify(current.map((credit) => credit.artistId))

  const artistIds = input.artistIds ?? []

  return {
    patch,
    changed,
    eligibility: references.eligibility,
    statements: (prepare, winner) =>
      changed
        ? [
            prepare(sql`DELETE FROM ${junction} WHERE ${parent}=${target.entityId}
        ${
          artistIds.length
            ? sql`AND artistId NOT IN (${sql.join(
                artistIds.map((id) => sql`${id}`),
                sql`, `,
              )})`
            : sql``
        }
        AND (${winner})`),
            ...artistIds.map((artistId, displayOrder) =>
              prepare(sql`INSERT INTO ${junction} (${parent},artistId,displayOrder)
        SELECT ${target.entityId},${artistId},${displayOrder} WHERE (${winner})
        ON CONFLICT(${parent},artistId) DO UPDATE SET displayOrder=excluded.displayOrder WHERE (${winner})`),
            ),
          ]
        : [],
  } satisfies MusicRelationshipPreparation
})

type RelationshipChange =
  | {
      readonly kind: 'credit'
      readonly artistId: string
      readonly action: 'set' | 'remove'
      readonly role?: string | undefined
      readonly displayOrder?: number | undefined
    }
  | { readonly kind: 'affiliation'; readonly labelId: string; readonly action: 'set' | 'remove' }

/** One receipt owns the target and, for affiliations, both observed roots.
 * Every coupled statement proves both physical winners; no-op writes stamp
 * markers and save receipts without rewriting billing or affiliation facts.
 */
export const writeMusicRelationship = Effect.fn('musicEntity.writeRelationship')(function* (
  target: MusicParent,
  change: RelationshipChange,
  write?: MusicWriteRequest,
) {
  if (!write)
    return yield* new MusicWriteError({
      code: 'precondition_required',
      message: 'Observed relationship intent is required.',
    })
  const db = yield* Database
  const affiliation = change.kind === 'affiliation'

  const reference: MusicParent = affiliation
    ? { entityType: 'label', entityId: change.labelId }
    : { entityType: 'artist', entityId: change.artistId }

  const junction = sql.identifier(
    affiliation
      ? target.entityType === 'artist'
        ? 'music_label_artists'
        : 'music_label_albums'
      : target.entityType === 'album'
        ? 'music_album_artists'
        : 'music_track_artists',
  )

  const parent = sql.identifier(
    affiliation
      ? target.entityType === 'artist'
        ? 'artist_id'
        : 'album_id'
      : target.entityType === 'album'
        ? 'albumId'
        : 'trackId',
  )

  const referenceColumn = sql.identifier(affiliation ? 'label_id' : 'artistId')
  const linked = sql`SELECT 1 FROM ${junction} WHERE ${parent}=${target.entityId} AND ${referenceColumn}=${reference.entityId}`
  const table = sql.identifier(tables[target.entityType])

  return yield* executeMusicWrite(write.intent, write.context, {
    operation: `${change.action}_music_${change.kind}`,
    target,
    disclosure: 'existing',
    normalizedInput: {
      kind: change.kind,
      action: change.action,
      reference: { ...reference },
      role: change.kind === 'credit' ? (change.role ?? null) : null,
      displayOrder: change.kind === 'credit' ? (change.displayOrder ?? 0) : null,
      references: write.references.map((observed) => ({ ...observed })),
    },
    prepare: Effect.gen(function* () {
      const raw = yield* Effect.tryPromise({
        try: () =>
          db.get(sql`SELECT revision,
          EXISTS (${linked}) AS linked,
          ${affiliation ? sql`NULL` : sql`(SELECT role FROM ${junction} WHERE ${parent}=${target.entityId} AND artistId=${reference.entityId})`} AS role,
          ${affiliation ? sql`NULL` : sql`(SELECT displayOrder FROM ${junction} WHERE ${parent}=${target.entityId} AND artistId=${reference.entityId})`} AS displayOrder
          FROM ${table} WHERE id=${target.entityId}`),
        catch: unavailable,
      })

      if (!raw)
        return yield* new MusicWriteError({ code: 'not_found', message: 'Music entity not found.' })

      const before = yield* Schema.decodeUnknownEffect(
        Schema.Struct({
          revision: MusicWriteIntent.fields.expectedRevision,
          linked: Schema.Literals([0, 1]),
          role: Schema.NullOr(Schema.String),
          displayOrder: Schema.NullOr(Schema.Int),
        }),
      )(raw).pipe(Effect.mapError(unavailable))

      const references = yield* observeMusicReferences([reference], write)
      const role = change.kind === 'credit' ? (change.role ?? before.role) : null
      const displayOrder = change.kind === 'credit' ? (change.displayOrder ?? 0) : 0

      if (change.kind === 'credit')
        yield* Schema.decodeUnknownEffect(
          Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10_000 })),
        )(displayOrder).pipe(
          Effect.mapError(
            () => new MusicWriteError({ code: 'invalid_input', message: 'Invalid billing order.' }),
          ),
        )

      const changed =
        change.action === 'remove'
          ? before.linked === 1
          : before.linked === 0 ||
            (!affiliation && (role !== before.role || displayOrder !== before.displayOrder))

      if (
        before.revision !== write.intent.expectedRevision ||
        (changed && before.revision === Number.MAX_SAFE_INTEGER)
      )
        return yield* new MusicWriteError({ code: 'conflict', message: 'Music revision changed.' })
      // observeMusicReferences has established exactly one caller-pinned entry.
      const observedReference = write.references[0]

      if (!observedReference) return yield* unavailable()

      return {
        build: (attempt) => {
          const winner = sql`(${attempt.fence}) AND (${attempt.liveGuard}) AND (${musicParentWinner(target, attempt.attemptId)})`

          const both = affiliation
            ? sql`(${winner}) AND (${musicParentWinner(reference, attempt.attemptId)})`
            : winner

          const statements = [
            attempt.prepare(
              musicParentCas({
                target,
                expectedRevision: write.intent.expectedRevision,
                changed,
                attemptId: attempt.attemptId,
                fence: attempt.fence,
                liveGuard: attempt.liveGuard,
                assignments: changed ? [sql`updatedAt=${write.context.now}`] : [],
                eligibility: sql`(${references.eligibility}) ${affiliation && changed ? sql`AND EXISTS (SELECT 1 FROM music_labels WHERE id=${reference.entityId} AND revision<${Number.MAX_SAFE_INTEGER})` : sql``}`,
              }),
            ),
          ]

          if (affiliation)
            statements.push(
              attempt.prepare(
                musicParentCas({
                  target: reference,
                  expectedRevision: observedReference.expectedRevision,
                  changed,
                  attemptId: attempt.attemptId,
                  fence: attempt.fence,
                  liveGuard: attempt.liveGuard,
                  eligibility: winner,
                  assignments: changed ? [sql`updated_at=${write.context.now}`] : [],
                }),
              ),
            )

          if (changed) {
            statements.push(
              attempt.prepare(
                change.action === 'remove'
                  ? sql`DELETE FROM ${junction} WHERE ${parent}=${target.entityId} AND ${referenceColumn}=${reference.entityId} AND (${both})`
                  : affiliation
                    ? sql`INSERT INTO ${junction} (${parent},label_id) SELECT ${target.entityId},${reference.entityId}
                  WHERE (${both}) ON CONFLICT DO NOTHING`
                    : sql`INSERT INTO ${junction} (${parent},artistId,role,displayOrder)
                  SELECT ${target.entityId},${reference.entityId},${role},${displayOrder} WHERE (${both})
                  ON CONFLICT(${parent},artistId) DO UPDATE SET role=excluded.role,displayOrder=excluded.displayOrder WHERE (${both})`,
              ),
            )

            if (!affiliation)
              statements.push(
                attempt.prepare(sql`UPDATE ${table} SET artistNames=(
                SELECT json_group_array(name) FROM (SELECT a.name FROM ${junction} c JOIN music_artists a ON a.id=c.artistId
                WHERE c.${parent}=${target.entityId} ORDER BY c.displayOrder,c.artistId))
                WHERE id=${target.entityId} AND (${both})`),
              )
          }

          return {
            statements,
            assertApplied: both,
            outcome: {
              result: null,
              revision: { ...target, revision: before.revision + (changed ? 1 : 0) },
              access: { ...target },
            },
          }
        },
      }
    }),
  }).pipe(Effect.asVoid)
})
