import {
  DraftMusicReferenceChange,
  DraftMusicReferences,
  DraftMusicTarget,
  draftMusicTargetKey,
  transitionDraftMusicReferences,
} from '@gbfm/core/post-music-references'
import { and, asc, eq, exists, inArray, or, sql, type SQL } from 'drizzle-orm'
import { Effect, Match, Schema } from 'effect'

import { DatabaseError, NotFoundError, ValidationError } from '@/errors'

import { user } from './auth.schema'
import { postIdsForCreator } from './creator-membership'
import type { DatabaseClient } from './layer'
import { musicAlbumsTable, musicPlaylistsTable, musicTracksTable } from './music-entity.schema'
import { postMusicReferencesTable } from './post-music-reference.schema'
import { postCreators, postsTable, type InsertPost } from './post.schema'
import { entityLabelsTable, labelsTable } from './tags.schema'
import { uploadAssetsTable } from './upload-asset.schema'

/** UUID identity ignores case; foreign keys and compatibility primaries retain actual stored spelling. */
export const canonicalPostMusicTarget = (db: DatabaseClient, target: DraftMusicTarget) =>
  Effect.gen(function* () {
    const table = Match.value(target.entityType).pipe(
      Match.when('album', () => musicAlbumsTable),
      Match.when('track', () => musicTracksTable),
      Match.when('playlist', () => musicPlaylistsTable),
      Match.exhaustive,
    )

    const failure = () =>
      new DatabaseError({
        message: 'Could not resolve catalogue identity',
        operation: 'select',
        table: 'music',
      })

    const rows = yield* Effect.tryPromise({
      try: () =>
        db
          .select({ id: table.id })
          .from(table)
          .where(sql`lower(${table.id}) = ${target.entityId.toLowerCase()}`)
          .limit(2),
      catch: failure,
    })

    if (rows.length > 1) return yield* failure()
    const row = rows[0]

    if (!row) return yield* new NotFoundError({ message: 'Music not found', resource: 'music' })

    return { entityType: target.entityType, entityId: row.id }
  })

/** One interpretation of stored rows and the virtual, unmanaged legacy primary for every writer. */
export const decodePostMusicReferenceState = (
  post: Pick<
    typeof postsTable.$inferSelect,
    'musicEntityType' | 'musicEntityId' | 'musicReferencesManaged'
  >,
  rows: ReadonlyArray<typeof postMusicReferencesTable.$inferSelect>,
) =>
  Effect.gen(function* () {
    const invalid = () => new ValidationError({ message: 'Invalid post music reference state' })

    if (rows.some((row, index) => row.position !== index)) return yield* invalid()

    if ((post.musicEntityId === null) !== (post.musicEntityType === null)) return yield* invalid()

    const legacy = yield* Schema.decodeUnknownEffect(Schema.NullOr(DraftMusicTarget))(
      post.musicEntityId === null
        ? null
        : { entityType: post.musicEntityType, entityId: post.musicEntityId },
    ).pipe(Effect.mapError(invalid))

    const targets = rows.map((row) => ({
      entityType: row.albumId !== null ? 'album' : row.trackId !== null ? 'track' : 'playlist',
      entityId: row.albumId ?? row.trackId ?? row.playlistId,
    }))

    const storedMusicReferences = yield* Schema.decodeUnknownEffect(DraftMusicReferences)({
      references: targets,
      primary: targets[rows.findIndex((row) => row.isPrimary)] ?? null,
    }).pipe(Effect.mapError(invalid))

    if (rows.length > 0 || post.musicReferencesManaged) {
      const primary = storedMusicReferences.primary

      if (
        (legacy === null) !== (primary === null) ||
        (legacy !== null &&
          primary !== null &&
          draftMusicTargetKey(legacy) !== draftMusicTargetKey(primary))
      )
        return yield* invalid()
    }

    return {
      storedMusicReferences,
      musicReferences:
        rows.length === 0 && !post.musicReferencesManaged && legacy !== null
          ? { references: [legacy], primary: legacy }
          : storedMusicReferences,
    }
  })

/** Builds one guarded save so callers can include domain writes and receipts in the same batch. */
export const buildGuardedPostUpdate = (
  db: DatabaseClient,
  existing: Pick<typeof postsTable.$inferSelect, 'id' | 'updatedAt' | 'draft'>,
  userId: string,
  data: Partial<InsertPost>,
  tags: ReadonlyArray<string> | undefined,
  assetKeys: ReadonlyArray<string>,
  options: {
    readonly guard?: SQL | undefined
    readonly now?: Date | undefined
    readonly allowAdmin?: boolean | undefined
    readonly attemptId?: string | undefined
    readonly liveGuard?: SQL | undefined
    readonly musicReferences?: DraftMusicReferences | undefined
    readonly creatorIds?: ReadonlyArray<string> | undefined
  } = {},
) => {
  const attemptId = options.attemptId ?? crypto.randomUUID()

  const predicate = and(
    eq(postsTable.id, existing.id),
    eq(postsTable.updatedAt, existing.updatedAt),
    eq(postsTable.draft, existing.draft),
    or(
      postIdsForCreator(db, userId),
      options.allowAdmin
        ? exists(
            db
              .select({ id: user.id })
              .from(user)
              .where(
                and(
                  eq(user.id, userId),
                  eq(user.role, 'admin'),
                  sql`coalesce(${user.banned}, 0) = 0`,
                ),
              ),
          )
        : undefined,
    ),
    options.guard,
    options.liveGuard,
    data.slug === undefined
      ? undefined
      : sql`NOT EXISTS (SELECT 1 FROM posts AS collision WHERE collision.slug = ${data.slug} AND collision.id <> ${existing.id})`,
  )

  const winner = exists(
    db
      .select({ id: postsTable.id })
      .from(postsTable)
      .where(and(eq(postsTable.id, existing.id), eq(postsTable.lastOperationId, attemptId))),
  )

  const authorized = sql`${winner} AND (${options.liveGuard ?? sql`1`})`

  const names = [...new Set(tags)]

  const labelWrites =
    tags === undefined
      ? []
      : [
          db
            .delete(entityLabelsTable)
            .where(
              and(
                eq(entityLabelsTable.entityType, 'post'),
                eq(entityLabelsTable.entityId, existing.id),
                authorized,
              ),
            ),
          ...names.flatMap((name, position) => [
            db
              .insert(labelsTable)
              .select(
                db
                  .select({
                    id: sql<string>`${crypto.randomUUID()}`.as('id'),
                    kind: sql<'tag'>`'tag'`.as('kind'),
                    name: sql<string>`${name}`.as('name'),
                  })
                  .from(sql`(SELECT 1)`)
                  .where(authorized),
              )
              .onConflictDoNothing(),
            db.insert(entityLabelsTable).select(
              db
                .select({
                  entityType: sql<'post'>`'post'`.as('entity_type'),
                  entityId: sql<string>`${existing.id}`.as('entity_id'),
                  position: sql<number>`${position}`.as('position'),
                  labelId: labelsTable.id,
                })
                .from(labelsTable)
                .where(and(eq(labelsTable.kind, 'tag'), eq(labelsTable.name, name), authorized)),
            ),
          ]),
        ]

  // The CAS runs first. Dependent writes use only its unique physical winner, never a mutated snapshot.
  const writes = [
    db
      .update(uploadAssetsTable)
      .set({ status: 'attached', attachedToTable: 'posts', attachedToId: existing.id })
      .where(
        and(
          inArray(uploadAssetsTable.key, [...assetKeys]),
          eq(uploadAssetsTable.status, 'uploaded'),
          eq(uploadAssetsTable.userId, userId),
          authorized,
        ),
      ),
    ...labelWrites,
    ...(options.musicReferences === undefined
      ? []
      : [
          db
            .delete(postMusicReferencesTable)
            .where(and(eq(postMusicReferencesTable.postId, existing.id), authorized)),
          ...options.musicReferences.references.map((target, position) =>
            db.insert(postMusicReferencesTable).select(
              db
                .select({
                  postId: sql<string>`${existing.id}`.as('post_id'),
                  position: sql<number>`${position}`.as('position'),
                  albumId: sql<
                    string | null
                  >`${target.entityType === 'album' ? target.entityId : null}`.as('album_id'),
                  trackId: sql<
                    string | null
                  >`${target.entityType === 'track' ? target.entityId : null}`.as('track_id'),
                  playlistId: sql<
                    string | null
                  >`${target.entityType === 'playlist' ? target.entityId : null}`.as('playlist_id'),
                  isPrimary:
                    sql<boolean>`${options.musicReferences?.primary !== null && options.musicReferences?.primary !== undefined && draftMusicTargetKey(target) === draftMusicTargetKey(options.musicReferences.primary) ? 1 : 0}`.as(
                      'is_primary',
                    ),
                })
                .from(sql`(SELECT 1)`)
                .where(authorized),
            ),
          ),
        ]),
    ...(options.creatorIds === undefined || options.creatorIds.length === 0
      ? []
      : [
          db.delete(postCreators).where(and(eq(postCreators.postId, existing.id), authorized)),
          ...options.creatorIds.map((creatorId) =>
            db.insert(postCreators).select(
              db
                .select({
                  postId: sql<string>`${existing.id}`.as('postId'),
                  creatorId: sql<string>`${creatorId}`.as('creatorId'),
                })
                .from(sql`(SELECT 1)`)
                .where(authorized),
            ),
          ),
        ]),
  ] as const

  const update = db
    .update(postsTable)
    .set({
      ...data,
      lastOperationId: attemptId,
      updatedAt: new Date(
        Math.max(options.now?.getTime() ?? Date.now(), existing.updatedAt.getTime() + 1),
      ),
    })
    .where(predicate)
    .returning()

  return { predicate, winner, authorized, writes, update, attemptId }
}

/** Full edit forms may echo an unchanged primary without editing the frozen association. */
export const changesPostMusicPrimary = (
  existing: Pick<typeof postsTable.$inferSelect, 'musicEntityId' | 'musicEntityType'>,
  data: Pick<Partial<InsertPost>, 'musicEntityId' | 'musicEntityType'>,
) =>
  (data.musicEntityType !== undefined && data.musicEntityType !== existing.musicEntityType) ||
  (data.musicEntityId !== undefined &&
    (data.musicEntityId?.toLowerCase() ?? null) !== (existing.musicEntityId?.toLowerCase() ?? null))

/** Atomically changes post fields, tags and owned upload tracking under the same version guard. */
export const guardedPostUpdate = async (
  db: DatabaseClient,
  existing: typeof postsTable.$inferSelect,
  userId: string,
  data: Partial<InsertPost>,
  tags: ReadonlyArray<string> | undefined,
  assetKeys: ReadonlyArray<string>,
  options: Parameters<typeof buildGuardedPostUpdate>[6] = {},
) => {
  let musicReferences = options.musicReferences
  let guard = options.guard
  const fields = { ...data }

  if (
    musicReferences === undefined &&
    (data.musicEntityId !== undefined || data.musicEntityType !== undefined)
  ) {
    if ((data.musicEntityId === undefined) !== (data.musicEntityType === undefined))
      throw new ValidationError({ message: 'Music primary must be supplied as a complete pair' })

    if (!changesPostMusicPrimary(existing, data)) {
      fields.musicEntityId = existing.musicEntityId
      fields.musicEntityType = existing.musicEntityType
    }
  }

  if (musicReferences === undefined && changesPostMusicPrimary(existing, data)) {
    if (existing.musicReferencesManaged && !existing.draft)
      throw new ValidationError({ message: 'Managed published music associations are frozen' })

    const rows = await db
      .select()
      .from(postMusicReferencesTable)
      .where(eq(postMusicReferencesTable.postId, existing.id))
      .orderBy(asc(postMusicReferencesTable.position))

    const state = await Effect.runPromise(decodePostMusicReferenceState(existing, rows))

    const parsedPrimary = await Effect.runPromise(
      Schema.decodeUnknownEffect(Schema.NullOr(DraftMusicTarget))(
        data.musicEntityId === null
          ? null
          : { entityType: data.musicEntityType, entityId: data.musicEntityId },
      ),
    )

    const primary =
      parsedPrimary === null
        ? null
        : await Effect.runPromise(canonicalPostMusicTarget(db, parsedPrimary))

    const next = await Effect.runPromise(
      transitionDraftMusicReferences(
        { musicReferences: state.musicReferences, managed: existing.musicReferencesManaged },
        DraftMusicReferenceChange.cases.LegacyPrimary.make({ primary }),
      ),
    )

    musicReferences = next.musicReferences
    fields.musicEntityType = next.musicReferences.primary?.entityType ?? null
    fields.musicEntityId = next.musicReferences.primary?.entityId ?? null
    fields.musicReferencesManaged = next.managed
    guard = and(guard, sql`${postsTable.lastOperationId} IS ${existing.lastOperationId}`)
  }

  const save = buildGuardedPostUpdate(db, existing, userId, fields, tags, assetKeys, {
    ...options,
    guard,
    musicReferences,
  })

  const [updated] = await db.batch([save.update, ...save.writes])

  return updated
}
