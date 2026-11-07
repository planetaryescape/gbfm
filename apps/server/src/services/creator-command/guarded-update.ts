import { and, eq, exists, inArray, or, sql, type SQL } from 'drizzle-orm'

import { audioArtists, audioCreators, audioTable, type InsertAudio } from '@/db/audio.schema'
import { user } from '@/db/auth.schema'
import { audioIdsForCreator, showIdsForCreator } from '@/db/creator-membership'
import type { DatabaseClient } from '@/db/layer'
import { showCreators, showsTable, type InsertShow } from '@/db/show.schema'
import { entityLabelsTable, labelsTable } from '@/db/tags.schema'
import { uploadAssetsTable } from '@/db/upload-asset.schema'

/** Audio/show writers share one persisted CAS and one physical attempt for every relation write. */
export const buildCreatorUpdate = (
  db: DatabaseClient,
  kind: 'audio' | 'show',
  previous: { readonly id: string; readonly revision: number; readonly draft: boolean },
  actorId: string,
  data: Partial<InsertAudio> | Partial<InsertShow>,
  options: {
    readonly attemptId: string
    readonly now: Date
    readonly guard?: SQL | undefined
    readonly liveGuard: SQL
    readonly allowAdmin?: boolean
    readonly tags?: ReadonlyArray<string> | undefined
    readonly creatorIds?: ReadonlyArray<string> | undefined
    readonly artistIds?: ReadonlyArray<string> | undefined
    readonly assetKeys?: ReadonlyArray<string> | undefined
  },
) => {
  const table = kind === 'audio' ? audioTable : showsTable

  const membership =
    kind === 'audio' ? audioIdsForCreator(db, actorId) : showIdsForCreator(db, actorId)

  const predicate = and(
    eq(table.id, previous.id),
    eq(table.revision, previous.revision),
    sql`${table.revision} < ${Number.MAX_SAFE_INTEGER}`,
    eq(table.draft, previous.draft),
    or(
      membership,
      options.allowAdmin
        ? exists(
            db
              .select({ id: user.id })
              .from(user)
              .where(and(eq(user.id, actorId), eq(user.role, 'admin'))),
          )
        : undefined,
    ),
    options.guard,
    options.liveGuard,
  )

  const winner = exists(
    db
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.id, previous.id), eq(table.lastOperationId, options.attemptId))),
  )

  const authorized = and(winner, options.liveGuard)

  const values = {
    ...data,
    updatedAt: options.now,
    revision: sql`${table.revision} + 1`,
    lastOperationId: options.attemptId,
  }

  const update =
    kind === 'audio'
      ? db.update(audioTable).set(values).where(predicate).returning()
      : db.update(showsTable).set(values).where(predicate).returning()

  const writes: Array<SQL> = []

  if (options.tags !== undefined) {
    writes.push(
      db
        .delete(entityLabelsTable)
        .where(
          and(
            eq(entityLabelsTable.entityType, kind),
            eq(entityLabelsTable.entityId, previous.id),
            authorized,
          ),
        )
        .getSQL(),
    )

    for (const [position, name] of [...new Set(options.tags)].entries()) {
      writes.push(
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
          .onConflictDoNothing()
          .getSQL(),
      )
      writes.push(
        db
          .insert(entityLabelsTable)
          .select(
            db
              .select({
                entityType: sql<typeof kind>`${kind}`.as('entity_type'),
                entityId: sql<string>`${previous.id}`.as('entity_id'),
                position: sql<number>`${position}`.as('position'),
                labelId: labelsTable.id,
              })
              .from(labelsTable)
              .where(and(eq(labelsTable.kind, 'tag'), eq(labelsTable.name, name), authorized)),
          )
          .getSQL(),
      )
    }
  }

  if (options.creatorIds !== undefined) {
    const owners = kind === 'audio' ? audioCreators : showCreators
    const column = kind === 'audio' ? audioCreators.audioId : showCreators.showId
    writes.push(
      db
        .delete(owners)
        .where(and(eq(column, previous.id), authorized))
        .getSQL(),
    )

    for (const creatorId of new Set(options.creatorIds)) {
      writes.push(
        kind === 'audio'
          ? db
              .insert(audioCreators)
              .select(
                db
                  .select({
                    audioId: sql<string>`${previous.id}`.as('audioId'),
                    creatorId: sql<string>`${creatorId}`.as('creatorId'),
                  })
                  .from(sql`(SELECT 1)`)
                  .where(authorized),
              )
              .getSQL()
          : db
              .insert(showCreators)
              .select(
                db
                  .select({
                    showId: sql<string>`${previous.id}`.as('showId'),
                    creatorId: sql<string>`${creatorId}`.as('creatorId'),
                  })
                  .from(sql`(SELECT 1)`)
                  .where(authorized),
              )
              .getSQL(),
      )
    }
  }

  if (kind === 'audio' && options.artistIds !== undefined) {
    writes.push(
      db
        .delete(audioArtists)
        .where(and(eq(audioArtists.audioId, previous.id), authorized))
        .getSQL(),
    )

    for (const [position, artistId] of [...new Set(options.artistIds)].entries()) {
      writes.push(
        db
          .insert(audioArtists)
          .select(
            db
              .select({
                audioId: sql<string>`${previous.id}`.as('audio_id'),
                artistId: sql<string>`${artistId}`.as('artist_id'),
                position: sql<number>`${position}`.as('position'),
              })
              .from(sql`(SELECT 1)`)
              .where(authorized),
          )
          .getSQL(),
      )
    }
  }

  if (options.assetKeys?.length) {
    writes.push(
      db
        .update(uploadAssetsTable)
        .set({
          status: 'attached',
          attachedToTable: kind === 'show' ? 'shows' : 'audio',
          attachedToId: previous.id,
        })
        .where(
          and(
            inArray(uploadAssetsTable.key, [...options.assetKeys]),
            eq(uploadAssetsTable.userId, actorId),
            eq(uploadAssetsTable.status, 'uploaded'),
            authorized,
          ),
        )
        .getSQL(),
    )
  }

  return { update, writes, winner, authorized }
}
