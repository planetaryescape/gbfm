import { sql } from 'drizzle-orm'
import { check, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { musicAlbumsTable, musicPlaylistsTable, musicTracksTable } from './music-entity.schema'
import { postsTable } from './post.schema'

/** Deliberate associations, not body embeds. The post writer owns projection and version atomicity. */
export const postMusicReferencesTable = sqliteTable(
  'post_music_references',
  {
    postId: text('post_id')
      .notNull()
      .references(() => postsTable.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    albumId: text('album_id').references(() => musicAlbumsTable.id, { onDelete: 'restrict' }),
    trackId: text('track_id').references(() => musicTracksTable.id, { onDelete: 'restrict' }),
    playlistId: text('playlist_id').references(() => musicPlaylistsTable.id, {
      onDelete: 'restrict',
    }),
    isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.position] }),
    check(
      'post_music_references_position_check',
      sql`typeof(${t.position}) = 'integer' AND ${t.position} BETWEEN 0 AND 49`,
    ),
    check(
      'post_music_references_target_check',
      sql`(${t.albumId} IS NOT NULL) + (${t.trackId} IS NOT NULL) + (${t.playlistId} IS NOT NULL) = 1`,
    ),
    check('post_music_references_primary_check', sql`${t.isPrimary} IN (0, 1)`),
    uniqueIndex('post_music_references_album_uq')
      .on(t.postId, t.albumId)
      .where(sql`${t.albumId} IS NOT NULL`),
    uniqueIndex('post_music_references_track_uq')
      .on(t.postId, t.trackId)
      .where(sql`${t.trackId} IS NOT NULL`),
    uniqueIndex('post_music_references_playlist_uq')
      .on(t.postId, t.playlistId)
      .where(sql`${t.playlistId} IS NOT NULL`),
    uniqueIndex('post_music_references_primary_uq')
      .on(t.postId)
      .where(sql`${t.isPrimary} = 1`),
  ],
)
