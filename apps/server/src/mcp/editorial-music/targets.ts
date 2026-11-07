import type { DraftMusicTarget } from '@gbfm/core/post-music-references'
import { and, eq, exists, sql } from 'drizzle-orm'
import { Clock, Effect } from 'effect'

import { Database, type DatabaseClient } from '@/db/layer'
import { musicAlbumsTable, musicPlaylistsTable, musicTracksTable } from '@/db/music-entity.schema'
import { getAlbumByIdEffect } from '@/services/music-entity/album.service'
import {
  getPublicPlaylistEffect,
  publicPlaylistPredicate,
} from '@/services/music-entity/playlist.service'
import { getTrackByIdEffect } from '@/services/music-entity/track.service'

import { notFound, unavailable } from '../model'
import { DraftReferenceDisplay, type ReferenceWriteResult } from './contracts'

/** Existing public catalogue projection only: no import, providers, actor bypass or track expansion. */
export const readDraftMusicTarget = (db: DatabaseClient, target: DraftMusicTarget) => {
  return Effect.gen(function* () {
    const entity = yield* Effect.gen(function* () {
      if (target.entityType === 'playlist') return yield* getPublicPlaylistEffect(target.entityId)

      if (target.entityType === 'album') return yield* getAlbumByIdEffect(target.entityId)

      return yield* getTrackByIdEffect(target.entityId)
    })

    return {
      target,
      title: entity.title,
      artistNames: 'artistNames' in entity ? (entity.artistNames ?? []) : [],
      coverImageUrl: entity.coverImageUrl,
    }
  }).pipe(
    Effect.provideService(Database, db),
    Effect.catchTags({
      NotFoundError: () => Effect.fail(notFound()),
      DatabaseError: () => Effect.fail(unavailable()),
    }),
    Effect.map((entity) => DraftReferenceDisplay.cases.Available.make(entity)),
  )
}

/** Recheck target existence and playlist publication in the post CAS, not only before it. */
export const draftMusicTargetsGuard = (
  db: DatabaseClient,
  targets: ReadonlyArray<DraftMusicTarget>,
  now: Date,
) =>
  and(
    ...targets.map((target) => {
      if (target.entityType === 'playlist')
        return exists(
          db
            .select({ id: musicPlaylistsTable.id })
            .from(musicPlaylistsTable)
            .where(and(eq(musicPlaylistsTable.id, target.entityId), publicPlaylistPredicate(now))),
        )
      const table = target.entityType === 'album' ? musicAlbumsTable : musicTracksTable

      return exists(db.select({ id: table.id }).from(table).where(eq(table.id, target.entityId)))
    }),
  )

/** Privacy can only subtract from the original result; replay never enriches old display metadata. */
export const maskReferenceWriteResult = (
  db: DatabaseClient,
  result: typeof ReferenceWriteResult.Type,
) =>
  Effect.gen(function* () {
    const now = new Date(yield* Clock.currentTimeMillis)

    const display = yield* Effect.forEach(
      result.post.musicReferences.display,
      (entry) => {
        if (DraftReferenceDisplay.guards.Unavailable(entry)) return Effect.succeed(entry)

        return Effect.tryPromise({
          try: () =>
            db
              .select({
                available: sql<number>`CASE WHEN ${draftMusicTargetsGuard(db, [entry.target], now)} THEN 1 ELSE 0 END`,
              })
              .from(sql`(SELECT 1)`),
          catch: unavailable,
        }).pipe(
          Effect.map((rows) =>
            rows[0]?.available === 1
              ? entry
              : DraftReferenceDisplay.cases.Unavailable.make({ target: entry.target }),
          ),
        )
      },
      { concurrency: 4 },
    )

    return {
      ...result,
      post: { ...result.post, musicReferences: { ...result.post.musicReferences, display } },
    }
  })
