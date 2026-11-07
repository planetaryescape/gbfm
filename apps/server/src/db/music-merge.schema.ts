import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/** Domain undo images expire independently of the common operation receipt. */
export const musicEntityMergesTable = sqliteTable(
  'music_entity_merges',
  {
    operationId: text('operation_id').primaryKey(),
    entityType: text('entity_type', {
      enum: ['artist', 'album', 'track', 'playlist', 'label'],
    }).notNull(),
    sourceId: text('source_id').notNull(),
    targetId: text('target_id').notNull(),
    sourceSlug: text('source_slug').notNull(),
    beforeImage: text('before_image'),
    afterDigest: text('after_digest').notNull(),
    createdAt: integer('created_at').notNull(),
    undoExpiresAt: integer('undo_expires_at').notNull(),
    restoredAt: integer('restored_at'),
  },
  (t) => [
    check('music_entity_merges_operation_check', sql`length(${t.operationId}) = 64`),
    check(
      'music_entity_merges_type_check',
      sql`${t.entityType} IN ('artist','album','track','playlist','label')`,
    ),
    check(
      'music_entity_merges_identity_check',
      sql`length(${t.sourceId}) > 0 AND length(${t.targetId}) > 0 AND length(${t.sourceSlug}) > 0 AND ${t.sourceId} <> ${t.targetId}`,
    ),
    check(
      'music_entity_merges_image_check',
      sql`${t.beforeImage} IS NULL OR (json_valid(${t.beforeImage}) AND length(CAST(${t.beforeImage} AS BLOB)) <= 262144)`,
    ),
    check(
      'music_entity_merges_digest_check',
      sql`length(${t.afterDigest}) = 64 AND ${t.afterDigest} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      'music_entity_merges_time_check',
      sql`typeof(${t.createdAt}) = 'integer' AND ${t.createdAt} BETWEEN 0 AND 9007199254740991 AND typeof(${t.undoExpiresAt}) = 'integer' AND ${t.undoExpiresAt} BETWEEN 0 AND 9007199254740991 AND ${t.undoExpiresAt} = ${t.createdAt} + 86400000 AND (${t.restoredAt} IS NULL OR (typeof(${t.restoredAt}) = 'integer' AND ${t.restoredAt} BETWEEN ${t.createdAt} AND 9007199254740991))`,
    ),
    uniqueIndex('music_entity_merges_active_source_uq')
      .on(t.entityType, t.sourceId)
      .where(sql`${t.restoredAt} IS NULL`),
    index('music_entity_merges_active_slug_idx')
      .on(t.entityType, t.sourceSlug)
      .where(sql`${t.restoredAt} IS NULL`),
    index('music_entity_merges_cleanup_idx')
      .on(t.undoExpiresAt)
      .where(sql`${t.beforeImage} IS NOT NULL`),
  ],
)
