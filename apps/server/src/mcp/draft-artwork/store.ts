import type { UserId } from '@gbfm/core/identity'
import { and, eq, exists, sql, type SQL } from 'drizzle-orm'
import { Effect } from 'effect'

import { editorialOperations } from '@/db/editorial-operation.schema'
import type { DatabaseClient } from '@/db/layer'
import { postCreators, postsTable } from '@/db/post.schema'
import { uploadAssetsTable } from '@/db/upload-asset.schema'

import { editorialSnapshotGuard, type EditorialSnapshot } from '../editorial-music/snapshot'
import { unavailable } from '../model'
import type { PreparedDraftImage } from './contracts'

export const savePreparedImage = (
  db: DatabaseClient,
  actorId: UserId,
  previous: EditorialSnapshot,
  operation: { readonly id: string; readonly inputHash: string },
  result: typeof PreparedDraftImage.Type,
  now: Date,
  liveGuard: SQL,
) =>
  Effect.tryPromise({
    try: () => {
      const eligible = and(
        eq(postsTable.id, previous.id),
        eq(postsTable.draft, true),
        eq(postsTable.type, 'post'),
        editorialSnapshotGuard(previous),
        exists(
          db
            .select()
            .from(postCreators)
            .where(
              and(eq(postCreators.postId, postsTable.id), eq(postCreators.creatorId, actorId)),
            ),
        ),
        liveGuard,
      )

      const winner = exists(
        db
          .select()
          .from(editorialOperations)
          .where(
            and(
              eq(editorialOperations.id, operation.id),
              eq(editorialOperations.result, JSON.stringify(result)),
            ),
          ),
      )

      return db.batch([
        db
          .insert(editorialOperations)
          .select(
            db
              .select({
                id: sql<string>`${operation.id}`.as('id'),
                actorId: sql<string>`${actorId}`.as('actor_id'),
                postId: sql<string>`${previous.id}`.as('post_id'),
                inputHash: sql<string>`${operation.inputHash}`.as('input_hash'),
                result: sql<string>`${JSON.stringify(result)}`.as('result'),
                createdAt: sql<Date>`${now.getTime()}`.as('created_at'),
              })
              .from(postsTable)
              .where(eligible),
          )
          .onConflictDoNothing(),
        db.insert(uploadAssetsTable).select(
          db
            .select({
              id: sql<string>`${result.upload.assetId}`.as('id'),
              userId: sql<string>`${actorId}`.as('user_id'),
              key: sql<string>`${result.upload.key}`.as('key'),
              bucket: sql<string>`${result.upload.bucket}`.as('bucket'),
              assetType: sql`'image'`.as('asset_type'),
              status: sql`'pending'`.as('status'),
              uploadId: sql`NULL`.as('upload_id'),
              expectedSize: sql<number>`${result.upload.fileSize}`.as('expected_size'),
              attachedToTable: sql`NULL`.as('attached_to_table'),
              attachedToId: sql`NULL`.as('attached_to_id'),
              createdAt: sql<Date>`${now.getTime()}`.as('created_at'),
              updatedAt: sql<Date>`${now.getTime()}`.as('updated_at'),
              expiresAt: sql<Date>`${now.getTime() + 24 * 60 * 60 * 1000}`.as('expires_at'),
            })
            .from(postsTable)
            .where(and(eligible, winner)),
        ),
        db
          .select({
            assertion: sql<number>`CASE WHEN NOT (${winner}) OR
          (EXISTS (SELECT 1 FROM ${postsTable} WHERE ${eligible})
            AND EXISTS (SELECT 1 FROM ${uploadAssetsTable}
              WHERE ${uploadAssetsTable.id} = ${result.upload.assetId}))
          THEN 1 ELSE json('artwork preparation assertion failed') END`,
          })
          .from(sql`(SELECT 1)`),
      ])
    },
    catch: unavailable,
  })
