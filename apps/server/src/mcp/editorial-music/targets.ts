import type { DraftMusicTarget } from '@gbfm/core/post-music-references'
import { and, eq, exists, sql } from 'drizzle-orm'
import { Clock, Effect } from 'effect'

import { canonicalPostMusicTarget } from '@/db/guarded-post-update'
import { Database, type DatabaseClient } from '@/db/layer'
import { musicAlbumsTable, musicPlaylistsTable, musicTracksTable } from '@/db/music-entity.schema'
import { getAlbumByIdEffect } from '@/services/music-entity/album.service'
import {
  getPublicPlaylistEffect,
  publicPlaylistPredicate,
} from '@/services/music-entity/playlist.service'
import { getTrackByIdEffect } from '@/services/music-entity/track.service'

import { notFound, projectPost, unavailable, type EditorialMcpSettings } from '../model'
import { DraftReferenceDisplay, type ReferenceWriteResult } from './contracts'
import type { EditorialSnapshot } from './snapshot'

/** Existing public catalogue projection only: no import, providers, actor bypass or track expansion. */
export const readDraftMusicTarget = (db: DatabaseClient, target: DraftMusicTarget) => {
  return Effect.gen(function* () {
    const canonical = yield* canonicalPostMusicTarget(db, target)

    const entity = yield* Effect.gen(function* () {
      if (canonical.entityType === 'playlist')
        return yield* getPublicPlaylistEffect(canonical.entityId)

      if (canonical.entityType === 'album') return yield* getAlbumByIdEffect(canonical.entityId)

      return yield* getTrackByIdEffect(canonical.entityId)
    })

    return {
      target: canonical,
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

/** Shared operation projection; no second display validator in replacement or incremental adapters. */
export const projectReferenceWriteResult = (
  db: DatabaseClient,
  next: EditorialSnapshot,
  config: typeof EditorialMcpSettings.Type,
) =>
  Effect.gen(function* () {
    const post = yield* projectPost(next, config)

    const display = yield* Effect.forEach(
      next.musicReferences.references,
      (target) =>
        readDraftMusicTarget(db, target).pipe(
          Effect.catchTag('EditorialToolError', (error) =>
            error.code === 'not_found'
              ? Effect.succeed(DraftReferenceDisplay.cases.Unavailable.make({ target }))
              : Effect.fail(error),
          ),
        ),
      { concurrency: 4 },
    )

    return {
      endpoint: {
        environment: config.environment,
        resourceUrl: config.resourceUrl,
        frontendUrl: config.frontendUrl,
      },
      post: { ...post, musicReferences: { ...next.musicReferences, display } },
    }
  })

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
            .where(
              and(
                eq(musicPlaylistsTable.id, target.entityId),
                sql`(SELECT count(*) FROM music_playlists WHERE lower(id) = ${target.entityId.toLowerCase()}) = 1`,
                publicPlaylistPredicate(now),
              ),
            ),
        )
      const table = target.entityType === 'album' ? musicAlbumsTable : musicTracksTable

      return exists(
        db
          .select({ id: table.id })
          .from(table)
          .where(
            and(
              eq(table.id, target.entityId),
              sql`(SELECT count(*) FROM ${table} WHERE lower(id) = ${target.entityId.toLowerCase()}) = 1`,
            ),
          ),
      )
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
